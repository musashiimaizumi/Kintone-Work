const express = require('express');
const { z } = require('zod');
const { getPrisma } = require('../services/db');
const { randomBytes } = require('crypto');
const { hashToken, encryptSecret, maskSecret } = require('../services/util');

const router = express.Router();

const tenantSchema = z.object({ name: z.string().min(1) });
router.post('/tenants', async (req, res) => {
  const prisma = getPrisma();
  try {
    const { name } = tenantSchema.parse(req.body || {});
    const id = 't_' + randomBytes(8).toString('hex');
    await prisma.tenant.create({ data: { id, name } });
    res.json({ tenant_id: id });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'invalid' });
  }
});

const appSchema = z.object({
  kintone_domain: z.string().min(1),
  app_code: z.string().min(1),
  auth_type: z.enum(['api_token', 'oauth']),
  api_token_enc: z.string().optional(),
  oauth_client_ref: z.string().optional(),
});
router.post('/tenants/:tenant/apps', async (req, res) => {
  const prisma = getPrisma();
  try {
    const { tenant } = req.params;
    let { kintone_domain, app_code, auth_type, api_token_enc, oauth_client_ref } = appSchema.parse(req.body || {});
    if (api_token_enc && !String(api_token_enc).startsWith('enc:gcm:')) {
      // 平文が渡された場合は保存前に暗号化
      api_token_enc = encryptSecret(api_token_enc);
    }
    const id = 'a_' + randomBytes(8).toString('hex');
    await prisma.app.create({
      data: {
        id,
        tenantId: tenant,
        kintoneDomain: kintone_domain,
        appCode: app_code,
        authType: auth_type,
        apiTokenEnc: api_token_enc || null,
        oauthClientRef: oauth_client_ref || null,
      }
    });
    res.json({ app_id: id });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'invalid' });
  }
});

// アプリ一覧（テナント内）
router.get('/tenants/:tenant/apps', async (req, res) => {
  const prisma = getPrisma();
  try {
    const { tenant } = req.params;
    const apps = await prisma.app.findMany({ where: { tenantId: tenant }, orderBy: { id: 'asc' } });
    const items = apps.map(a => ({
      id: a.id,
      kintone_domain: a.kintoneDomain,
      app_code: a.appCode,
      auth_type: a.authType,
      api_token_masked: a.apiTokenEnc ? maskSecret(a.apiTokenEnc) : null,
      oauth_client_ref: a.oauthClientRef || null,
    }));
    res.json({ items });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'invalid' });
  }
});

const schemaSchema = z.object({ app_id: z.string().min(1), json: z.any() });
router.post('/tenants/:tenant/schemas/forms', async (req, res) => {
  const prisma = getPrisma();
  try {
    const { tenant } = req.params;
    const { app_id, json } = schemaSchema.parse(req.body || {});
    const id = 's_' + randomBytes(8).toString('hex');
    await prisma.schema.create({ data: { id, tenantId: tenant, appId: app_id, type: 'form', json, version: 1 } });
    res.json({ schema_id: id });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'invalid' });
  }
});

router.post('/tenants/:tenant/schemas/views', async (req, res) => {
  const prisma = getPrisma();
  try {
    const { tenant } = req.params;
    const { app_id, json } = schemaSchema.parse(req.body || {});
    const id = 's_' + randomBytes(8).toString('hex');
    await prisma.schema.create({ data: { id, tenantId: tenant, appId: app_id, type: 'view', json, version: 1 } });
    res.json({ schema_id: id });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'invalid' });
  }
});

// トークン発行（プレーンは返すがDBにはハッシュのみ保存）
const tokenIssueSchema = z.object({
  scope: z.enum(['view', 'edit']),
  expiry_minutes: z.number().int().min(1).max(24 * 60),
  record_ref: z.string().optional(),
});
router.post('/tenants/:tenant/apps/:app/tokens', async (req, res) => {
  const prisma = getPrisma();
  try {
    const { tenant, app } = req.params;
    const { scope, expiry_minutes, record_ref } = tokenIssueSchema.parse(req.body || {});
    const plaintext = randomBytes(24).toString('hex');
    const hash = hashToken(plaintext);
    const expiry = new Date(Date.now() + expiry_minutes * 60 * 1000);
    await prisma.token.create({
      data: { hash, tenantId: tenant, appId: app, recordRef: record_ref || null, scope, expiry }
    });
    // プレーンはレスポンスのみ。保存しない。
    res.json({ token: plaintext, scope, expiry });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'invalid' });
  }
});

module.exports = router;
