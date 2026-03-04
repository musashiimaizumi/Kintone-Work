const express = require('express');
const { z } = require('zod');
const { kintoneCreate } = require('../services/kintone');
const { auditLog } = require('../services/audit');
const { getPrisma } = require('../services/db');

const router = express.Router({ mergeParams: true });

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const serveFormPage = (req, res) => {
  const { tenant, app } = req.params;
  const title = `フォーム入力 - ${tenant}/${app}`;
  const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; padding: 1.5rem; background: #f7f7f7; }
    main { max-width: 720px; margin: 0 auto; background: #fff; padding: 1.5rem; border-radius: 1rem; box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
    h1 { margin-top: 0; font-size: 1.6rem; }
    .meta { color: #666; font-size: .9rem; margin-bottom: 1rem; }
    #schemaStatus, #submitMsg { margin: .75rem 0; }
    form div.field { margin-bottom: 1rem; }
    label { display: block; font-weight: 600; margin-bottom: .25rem; }
    input, select, textarea { width: 100%; padding: .6rem; border: 1px solid #ccc; border-radius: .4rem; font-size: 1rem; }
    textarea { min-height: 120px; resize: vertical; }
    .option-list { display: flex; flex-wrap: wrap; gap: .5rem 1rem; }
    .option-list label { font-weight: 400; display: flex; align-items: center; gap: .25rem; }
    button[type="submit"] { background: #0d68ff; color: #fff; border: none; padding: .75rem 1.5rem; border-radius: 999px; font-size: 1rem; cursor: pointer; }
    button[type="submit"]:disabled { opacity: .5; cursor: not-allowed; }
  </style>
</head>
<body data-tenant="${escapeHtml(tenant)}" data-app="${escapeHtml(app)}">
  <main>
    <h1>フォーム入力</h1>
    <p class="meta">Tenant: ${escapeHtml(tenant)} / App: ${escapeHtml(app)}</p>
    <p id="schemaStatus" class="meta">フォーム定義を取得しています...</p>
    <form id="dynamicForm" hidden>
      <div id="fieldsContainer"></div>
      <button type="submit">送信</button>
      <div id="submitMsg" class="meta"></div>
    </form>
  </main>
  <script src="/admin/ui/form-client.js" defer></script>
</body>
</html>`;
  res.type('html').send(html);
};

router.get('/', serveFormPage);
router.get('', serveFormPage);

const submitSchema = z.object({ payload: z.record(z.any()) });

router.post('/submit', async (req, res) => {
  const { tenant, app } = req.params;
  try {
    const { payload } = submitSchema.parse(req.body);
    const result = await kintoneCreate(tenant, app, payload);
    await auditLog({
      tenant, app, action: 'create', result: 'success',
      kintone_record_id: result.recordId, kintone_revision: result.revision,
      client_ip: req.ip, user_agent: req.headers['user-agent'] || '',
      token_hash_ref: null
    });
    return res.json({ ok: true, recordId: result.recordId, revision: result.revision });
  } catch (e) {
    await auditLog({
      tenant, app, action: 'create', result: 'fail',
      error_status_code: e.status || 500,
      error_message_sanitized: (e.message || 'error'),
      client_ip: req.ip, user_agent: req.headers['user-agent'] || '',
      token_hash_ref: null
    });
    return res.status(400).json({ ok: false });
  }
});

router.get('/schema', async (req, res) => {
  const { tenant, app } = req.params;
  const prisma = getPrisma();
  try {
    const schema = await prisma.schema.findFirst({
      where: { tenantId: tenant, appId: app, type: 'form' },
      orderBy: { version: 'desc' },
    });
    if (!schema) {
      return res.status(404).json({ ok: false, error: 'schema_not_found' });
    }
    res.json({ ok: true, form: schema.json });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'schema_fetch_failed' });
  }
});

module.exports = router;
