const express = require('express');
const { z } = require('zod');
const { getPrisma } = require('../services/db');
const { randomBytes } = require('crypto');
const { hashToken, encryptSecret, decryptSecret, maskSecret } = require('../services/util');
const { fetchKintoneAppSchemaByConfig } = require('../services/kintone');
const { createAdminUserAccount, listAdminUsers, sanitizeAdminUser } = require('../services/adminAuth');

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

router.get('/tenants', async (req, res) => {
  const prisma = getPrisma();
  try {
    const tenants = await prisma.tenant.findMany({
      orderBy: { id: 'asc' },
      include: {
        apps: {
          orderBy: { id: 'asc' },
        },
      },
    });
    const items = tenants.map((t) => ({
      id: t.id,
      name: t.name,
      app_count: t.apps.length,
      apps: t.apps.map((a) => ({
        id: a.id,
        app_code: a.appCode,
        kintone_domain: a.kintoneDomain,
        auth_type: a.authType,
      })),
    }));
    res.json({ items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'tenant_list_failed' });
  }
});

router.delete('/tenants/:tenant', async (req, res) => {
  const prisma = getPrisma();
  try {
    const { tenant } = req.params;
    const exists = await prisma.tenant.findUnique({ where: { id: tenant }, select: { id: true } });
    if (!exists) {
      return res.status(404).json({ ok: false, error: 'tenant_not_found' });
    }
    const result = await prisma.$transaction(async (tx) => {
      const apps = await tx.app.findMany({ where: { tenantId: tenant }, select: { id: true } });
      const appIds = apps.map((a) => a.id);
      const deletedSchemas = await tx.schema.deleteMany({ where: { tenantId: tenant } });
      const deletedTokens = await tx.token.deleteMany({ where: { tenantId: tenant } });
      const deletedApps = await tx.app.deleteMany({ where: { tenantId: tenant } });
      const deletedTenant = await tx.tenant.delete({ where: { id: tenant } });
      return {
        tenant_id: deletedTenant.id,
        deleted_apps: deletedApps.count,
        deleted_schemas: deletedSchemas.count,
        deleted_tokens: deletedTokens.count,
        app_ids: appIds,
      };
    });
    return res.json({ ok: true, ...result, kintone_affected: false });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message || 'tenant_delete_failed' });
  }
});

const appSchema = z.object({
  kintone_domain: z.string().min(1),
  app_code: z.string().min(1),
  auth_type: z.enum(['api_token', 'oauth']),
  api_token_enc: z.string().optional(),
  oauth_client_ref: z.string().optional(),
  auto_schema: z.boolean().optional(),
});
router.post('/tenants/:tenant/apps', async (req, res) => {
  const prisma = getPrisma();
  try {
    const { tenant } = req.params;
    let { kintone_domain, app_code, auth_type, api_token_enc, oauth_client_ref, auto_schema } = appSchema.parse(req.body || {});
    if (api_token_enc && !String(api_token_enc).startsWith('enc:gcm:')) {
      api_token_enc = encryptSecret(api_token_enc);
    }
    const autoSchemaEnabled = auto_schema !== false;
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
        createdByAdminId: req.adminDbUserId || null,
      }
    });
    const result = { app_id: id };
    if (autoSchemaEnabled && auth_type === 'api_token' && api_token_enc) {
      try {
        const decryptedToken = String(api_token_enc).startsWith('enc:gcm:') ? decryptSecret(api_token_enc) : api_token_enc;
        const schemaData = await fetchKintoneAppSchemaByConfig({
          domain: kintone_domain,
          appId: Number(app_code),
          apiToken: decryptedToken,
        });
        const formSchemaId = 's_' + randomBytes(8).toString('hex');
        const viewSchemaId = 's_' + randomBytes(8).toString('hex');
        await prisma.schema.create({
          data: { id: formSchemaId, tenantId: tenant, appId: id, type: 'form', json: schemaData.form, version: 1 }
        });
        await prisma.schema.create({
          data: { id: viewSchemaId, tenantId: tenant, appId: id, type: 'view', json: schemaData.views, version: 1 }
        });
        result.schema = {
          source: schemaData.source,
          form_schema_id: formSchemaId,
          view_schema_id: viewSchemaId,
          form: schemaData.form,
          views: schemaData.views,
        };
      } catch (schemaError) {
        result.schema_error = schemaError.message || 'schema_fetch_failed';
      }
    }
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'invalid' });
  }
});

// アプリ一覧（テナント内）
router.get('/tenants/:tenant/apps', async (req, res) => {
  const prisma = getPrisma();
  try {
    const { tenant } = req.params;
    const apps = await prisma.app.findMany({
      where: { tenantId: tenant },
      orderBy: { id: 'asc' },
      include: { createdByAdmin: true },
    });
    const items = apps.map(a => ({
      id: a.id,
      kintone_domain: a.kintoneDomain,
      app_code: a.appCode,
      auth_type: a.authType,
      api_token_masked: a.apiTokenEnc ? maskSecret(a.apiTokenEnc) : null,
      oauth_client_ref: a.oauthClientRef || null,
      created_by_admin: a.createdByAdmin ? sanitizeAdminUser(a.createdByAdmin) : null,
    }));
    res.json({ items });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'invalid' });
  }
});

// アプリ一覧（全テナント）
router.get('/apps', async (req, res) => {
  const prisma = getPrisma();
  try {
    const apps = await prisma.app.findMany({
      include: { tenant: true, createdByAdmin: true },
      orderBy: [{ tenantId: 'asc' }, { id: 'asc' }],
    });
    const items = apps.map(a => ({
      id: a.id,
      tenant_id: a.tenantId,
      tenant_name: a.tenant ? a.tenant.name : null,
      kintone_domain: a.kintoneDomain,
      app_code: a.appCode,
      auth_type: a.authType,
      api_token_masked: a.apiTokenEnc ? maskSecret(a.apiTokenEnc) : null,
      oauth_client_ref: a.oauthClientRef || null,
      created_by_admin: a.createdByAdmin ? sanitizeAdminUser(a.createdByAdmin) : null,
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

const adminUserSchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(8).max(128),
  display_name: z.string().min(1).max(255).optional(),
});

router.post('/users', async (req, res) => {
  try {
    const body = adminUserSchema.parse(req.body || {});
    const user = await createAdminUserAccount({
      username: body.username,
      password: body.password,
      displayName: body.display_name,
    });
    res.json({ ok: true, user });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'invalid' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const users = await listAdminUsers();
    res.json({ items: users });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'unknown_error' });
  }
});

module.exports = router;
