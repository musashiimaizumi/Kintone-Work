const express = require('express');
const { z } = require('zod');
const { kintoneGetByToken, kintoneUpdateByToken, kintoneGetById, kintoneUpdateById } = require('../services/kintone');
const { auditLog } = require('../services/audit');
const { getPrisma } = require('../services/db');
const { hashToken } = require('../services/util');

const router = express.Router({ mergeParams: true });

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const serveRecordEntryPage = (req, res) => {
  const { tenant, app } = req.params;
  const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>レコード表示・編集 - ${escapeHtml(tenant)}/${escapeHtml(app)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 900px; }
    .muted { color: #666; }
    .err { color: #a00; }
    .ok { color: #0a0; }
    input, button { padding: .5rem; font-size: 1rem; }
    input { width: 100%; box-sizing: border-box; margin: .5rem 0; }
    pre { background: #f6f6f6; border: 1px solid #ddd; padding: .75rem; overflow: auto; }
    .row { display: flex; gap: .5rem; margin-bottom: .5rem; }
    textarea { width: 100%; min-height: 260px; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .toolbar { display: flex; gap: .5rem; flex-wrap: wrap; margin: .75rem 0; }
    a { color: #0a53c1; }
  </style>
</head>
<body data-tenant="${escapeHtml(tenant)}" data-app="${escapeHtml(app)}">
  <h1>レコード表示・編集</h1>
  <p class="muted">Tenant: ${escapeHtml(tenant)} / App: ${escapeHtml(app)}</p>
  <div class="toolbar">
    <a href="/${encodeURIComponent(tenant)}/${encodeURIComponent(app)}/viewer/ui" target="_blank" rel="noopener">一覧画面を開く</a>
    <a href="/${encodeURIComponent(tenant)}/${encodeURIComponent(app)}/form" target="_blank" rel="noopener">新規作成フォームを開く</a>
  </div>
  <p class="muted">レコードIDで直接表示/編集、またはトークンで参照できます。</p>

  <label for="recordId">レコードID（推奨）</label>
  <input id="recordId" placeholder="例: 123" />
  <div class="row">
    <button id="loadByIdBtn" type="button">IDで読み込み</button>
    <button id="updateByIdBtn" type="button">IDで更新</button>
  </div>

  <label for="token">トークン（既存互換）</label>
  <input id="token" placeholder="管理画面のトークン発行で取得した値" />
  <div class="row">
    <button id="loadByTokenBtn" type="button">トークンで参照</button>
    <button id="updateByTokenBtn" type="button">トークンで更新</button>
  </div>

  <div id="status" class="muted"></div>
  <textarea id="payloadJson" placeholder='{"fieldCode":"new value"}'></textarea>
  <pre id="result" hidden></pre>

  <script src="/admin/ui/record-client.js" defer></script>
</body>
</html>`;
  res.type('html').send(html);
};

router.get('/ui', serveRecordEntryPage);
router.get('/', serveRecordEntryPage);
router.get('', serveRecordEntryPage);

const idSchema = z.object({ recordId: z.string().min(1) });
const updateSchema = z.object({ payload: z.record(z.any()) });

router.get('/id/:recordId', async (req, res) => {
  const { tenant, app } = req.params;
  try {
    const { recordId } = idSchema.parse(req.params);
    const result = await kintoneGetById(tenant, app, recordId);
    await auditLog({
      tenant, app, action: 'view', result: 'success',
      kintone_record_id: result.recordId, kintone_revision: result.revision,
      client_ip: req.ip, user_agent: req.headers['user-agent'] || '',
      token_hash_ref: null,
    });
    return res.json({ ok: true, data: result.fields, recordId: result.recordId, revision: result.revision });
  } catch (e) {
    await auditLog({
      tenant, app, action: 'view', result: 'fail',
      error_status_code: e.status || 500,
      error_message_sanitized: (e.message || 'error'),
      client_ip: req.ip, user_agent: req.headers['user-agent'] || '',
      token_hash_ref: null,
    });
    return res.status(e.status || 400).json({ ok: false, error: e.message || 'record_fetch_failed' });
  }
});

router.put('/id/:recordId', async (req, res) => {
  const { tenant, app } = req.params;
  try {
    const { recordId } = idSchema.parse(req.params);
    const { payload } = updateSchema.parse(req.body || {});
    const result = await kintoneUpdateById(tenant, app, recordId, payload);
    await auditLog({
      tenant, app, action: 'update', result: 'success',
      kintone_record_id: result.recordId, kintone_revision: result.revision,
      client_ip: req.ip, user_agent: req.headers['user-agent'] || '',
      token_hash_ref: null,
    });
    return res.json({ ok: true, recordId: result.recordId, revision: result.revision });
  } catch (e) {
    await auditLog({
      tenant, app, action: 'update', result: 'fail',
      error_status_code: e.status || 500,
      error_message_sanitized: (e.message || 'error'),
      client_ip: req.ip, user_agent: req.headers['user-agent'] || '',
      token_hash_ref: null,
    });
    return res.status(e.status || 400).json({ ok: false, error: e.message || 'record_update_failed' });
  }
});

router.get('/:token', async (req, res) => {
  const { tenant, app, token } = req.params;
  const prisma = getPrisma();
  const h = hashToken(token);
  try {
    const tok = await prisma.token.findUnique({ where: { hash: h } });
    if (!tok || tok.tenantId !== tenant || tok.appId !== app || tok.scope !== 'view' || tok.expiry < new Date()) {
      await auditLog({ tenant, app, action: 'view', result: 'fail', client_ip: req.ip, user_agent: req.headers['user-agent'] || '', token_hash_ref: h, error_status_code: 401, error_message_sanitized: 'invalid_or_expired_token' });
      return res.status(401).json({ ok: false });
    }
    const result = await kintoneGetByToken(tenant, app, token);
    await auditLog({
      tenant, app, action: 'view', result: 'success',
      kintone_record_id: result.recordId, kintone_revision: result.revision,
      client_ip: req.ip, user_agent: req.headers['user-agent'] || '',
      token_hash_ref: h
    });
    return res.json({ ok: true, data: result.fields });
  } catch (e) {
    await auditLog({
      tenant, app, action: 'view', result: 'fail',
      error_status_code: e.status || 500,
      error_message_sanitized: (e.message || 'error'),
      client_ip: req.ip, user_agent: req.headers['user-agent'] || '',
      token_hash_ref: h
    });
    return res.status(404).json({ ok: false });
  }
});

router.put('/:token', async (req, res) => {
  const { tenant, app, token } = req.params;
  const prisma = getPrisma();
  const h = hashToken(token);
  const payload = req.body || {};
  try {
    const tok = await prisma.token.findUnique({ where: { hash: h } });
    if (!tok || tok.tenantId !== tenant || tok.appId !== app || tok.scope !== 'edit' || tok.expiry < new Date()) {
      await auditLog({ tenant, app, action: 'update', result: 'fail', client_ip: req.ip, user_agent: req.headers['user-agent'] || '', token_hash_ref: h, error_status_code: 401, error_message_sanitized: 'invalid_or_expired_token' });
      return res.status(401).json({ ok: false });
    }
    const result = await kintoneUpdateByToken(tenant, app, token, payload);
    await auditLog({
      tenant, app, action: 'update', result: 'success',
      kintone_record_id: result.recordId, kintone_revision: result.revision,
      client_ip: req.ip, user_agent: req.headers['user-agent'] || '',
      token_hash_ref: h
    });
    return res.json({ ok: true, recordId: result.recordId, revision: result.revision });
  } catch (e) {
    await auditLog({
      tenant, app, action: 'update', result: 'fail',
      error_status_code: e.status || 500,
      error_message_sanitized: (e.message || 'error'),
      client_ip: req.ip, user_agent: req.headers['user-agent'] || '',
      token_hash_ref: h
    });
    return res.status(400).json({ ok: false });
  }
});

module.exports = router;
