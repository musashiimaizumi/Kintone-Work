const express = require('express');
const { z } = require('zod');
const { kintoneCreate } = require('../services/kintone');
const { auditLog } = require('../services/audit');

const router = express.Router({ mergeParams: true });

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

module.exports = router;
