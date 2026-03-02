const express = require('express');
const { z } = require('zod');
const { kintoneGetByToken, kintoneUpdateByToken } = require('../services/kintone');
const { auditLog } = require('../services/audit');
const { getPrisma } = require('../services/db');
const { hashToken } = require('../services/util');

const router = express.Router({ mergeParams: true });

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
