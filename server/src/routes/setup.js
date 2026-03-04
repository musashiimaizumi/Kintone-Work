const express = require('express');
const { randomBytes } = require('crypto');
const { z } = require('zod');
const { getPrisma } = require('../services/db');
const { createAdminUserAccount } = require('../services/adminAuth');
const fs = require('fs');
const path = require('path');

const router = express.Router();

function upsertEnvValue(envPath, key, value) {
  let text = '';
  if (fs.existsSync(envPath)) {
    text = fs.readFileSync(envPath, 'utf8');
  }
  const lines = text ? text.split(/\r?\n/) : [];
  let found = false;
  const out = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) out.push(`${key}=${value}`);
  fs.writeFileSync(envPath, out.filter((l, i, arr) => !(i === arr.length - 1 && l === '')).join('\n') + '\n', 'utf8');
}

router.post('/bootstrap', async (req, res) => {
  const prisma = getPrisma();
  try {
    const tenantCount = await prisma.tenant.count();
    if (tenantCount > 0 || process.env.ADMIN_TOKEN) {
      return res.status(409).json({ ok: false, error: 'already_initialized' });
    }

    const bootstrapSchema = z.object({
      tenant_name: z.string().optional(),
      admin_username: z.string().min(3).max(64),
      admin_password: z.string().min(8).max(128),
      admin_display_name: z.string().min(1).max(255).optional(),
    });
    const payload = bootstrapSchema.safeParse(req.body || {});
    if (!payload.success) {
      return res.status(400).json({ ok: false, error: 'invalid_body' });
    }

    const tenantName = payload.data.tenant_name && payload.data.tenant_name.trim()
      ? payload.data.tenant_name.trim()
      : 'default';
    const tenantId = 't_' + randomBytes(8).toString('hex');
    const adminToken = 'adm_' + randomBytes(24).toString('hex');

    const { adminUser } = await prisma.$transaction(async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: tenantName } });
      const createdAdminUser = await createAdminUserAccount({
        username: payload.data.admin_username,
        password: payload.data.admin_password,
        displayName: payload.data.admin_display_name,
      }, tx);
      return { adminUser: createdAdminUser };
    });

    const envPath = path.resolve(process.cwd(), '.env');
    upsertEnvValue(envPath, 'ADMIN_TOKEN', adminToken);
    process.env.ADMIN_TOKEN = adminToken;

    return res.json({ ok: true, tenant_id: tenantId, admin_token: adminToken, admin_user: adminUser });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'bootstrap_failed' });
  }
});

module.exports = router;
