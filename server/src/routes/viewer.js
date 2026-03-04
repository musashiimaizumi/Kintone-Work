const express = require('express');
const { kintoneQuery } = require('../services/kintone');
const { auditLog } = require('../services/audit');

const router = express.Router({ mergeParams: true });

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const serveViewerPage = (req, res) => {
  const { tenant, app } = req.params;
  const title = `レコード一覧 - ${tenant}/${app}`;
  const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1.5rem; }
    .muted { color: #666; }
    .err { color: #a00; }
    .ok { color: #0a0; }
    .toolbar { display: flex; gap: .5rem; align-items: center; margin: .75rem 0; flex-wrap: wrap; }
    input, button { padding: .45rem .6rem; font-size: .95rem; }
    input { min-width: 280px; }
    table { width: 100%; border-collapse: collapse; margin-top: .75rem; }
    th, td { border: 1px solid #ddd; padding: .45rem; vertical-align: top; }
    pre { margin: 0; max-height: 180px; overflow: auto; background: #f8f8f8; padding: .5rem; }
    a { color: #0a53c1; }
  </style>
</head>
<body data-tenant="${escapeHtml(tenant)}" data-app="${escapeHtml(app)}">
  <h1>レコード一覧</h1>
  <p class="muted">Tenant: ${escapeHtml(tenant)} / App: ${escapeHtml(app)}</p>
  <div class="toolbar">
    <button id="reloadBtn" type="button">再読み込み</button>
    <input id="queryInput" placeholder="任意: Kintone query (例: order by $id desc limit 50)" />
    <button id="queryBtn" type="button">条件で取得</button>
    <a id="createLink" href="/${encodeURIComponent(tenant)}/${encodeURIComponent(app)}/form" target="_blank" rel="noopener">新規作成フォーム</a>
  </div>
  <div id="status" class="muted">読み込み待ち</div>
  <div id="tableWrap"></div>
  <script src="/admin/ui/viewer-client.js" defer></script>
</body>
</html>`;
  res.type('html').send(html);
};

const listRecords = async (req, res) => {
  const { tenant, app } = req.params;
  const query = typeof req.query.query === 'string' ? req.query.query : '';
  try {
    const result = await kintoneQuery(tenant, app, { query });
    await auditLog({
      tenant, app, action: 'list', result: 'success',
      client_ip: req.ip, user_agent: req.headers['user-agent'] || ''
    });
    return res.json({ ok: true, items: result.items });
  } catch (e) {
    await auditLog({
      tenant, app, action: 'list', result: 'fail',
      error_status_code: e.status || 500,
      error_message_sanitized: (e.message || 'error'),
      client_ip: req.ip, user_agent: req.headers['user-agent'] || ''
    });
    return res.status(400).json({ ok: false, error: e.message || 'list_failed' });
  }
};

router.get('/ui', serveViewerPage);
router.get('/data', listRecords);

router.get('/', async (req, res) => {
  const wantsJson = req.query.format === 'json' || (req.headers.accept || '').includes('application/json');
  if (wantsJson) return listRecords(req, res);
  return serveViewerPage(req, res);
});

module.exports = router;
