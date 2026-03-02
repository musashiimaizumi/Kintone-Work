const express = require('express');
const { kintoneQuery } = require('../services/kintone');
const { auditLog } = require('../services/audit');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res) => {
  const { tenant, app } = req.params;
  try {
    const result = await kintoneQuery(tenant, app, {});
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
    return res.status(400).json({ ok: false });
  }
});

module.exports = router;
