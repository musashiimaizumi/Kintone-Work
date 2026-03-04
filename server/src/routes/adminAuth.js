const express = require('express');
const { z } = require('zod');
const {
  loginAdminWithPassword,
  logoutAdminSession,
  requireAdminAuth,
  extractSessionToken,
} = require('../services/adminAuth');

const router = express.Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = loginSchema.parse(req.body || {});
    const result = await loginAdminWithPassword(username, password);
    if (!result) {
      return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    }
    return res.json({ ok: true, token: result.token, expires_at: result.expires_at, user: result.user });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message || 'invalid' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const rawToken = extractSessionToken(req) || (typeof req.body?.session_token === 'string' ? req.body.session_token : null);
    if (rawToken) {
      await logoutAdminSession(rawToken);
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'logout_failed' });
  }
});

router.get('/me', requireAdminAuth, (req, res) => {
  return res.json({ ok: true, user: req.adminUser || null });
});

module.exports = router;
