const bcrypt = require('bcryptjs');
const { randomBytes } = require('crypto');
const { getPrisma } = require('./db');
const { hashToken } = require('./util');

const SESSION_TTL_MINUTES = Math.max(5, parseInt(process.env.ADMIN_SESSION_TTL_MINUTES || '720', 10));
const PASSWORD_MIN_LENGTH = Math.max(8, parseInt(process.env.ADMIN_PASSWORD_MIN_LENGTH || '12', 10));
const BCRYPT_ROUNDS = Math.max(10, parseInt(process.env.ADMIN_PASSWORD_SALT_ROUNDS || '12', 10));

function parseBasicAuthHeader(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  if (!headerValue.startsWith('Basic ')) return null;
  try {
    const encoded = headerValue.slice(6).trim();
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return null;
    return {
      user: decoded.slice(0, idx),
      pass: decoded.slice(idx + 1),
    };
  } catch {
    return null;
  }
}

function hasBasicConfig() {
  return Boolean(process.env.ADMIN_BASIC_USER) && Boolean(process.env.ADMIN_BASIC_PASS);
}

function hasTokenConfig() {
  return Boolean(process.env.ADMIN_TOKEN);
}

function verifyBasic(req) {
  if (!hasBasicConfig()) return null;
  const basic = parseBasicAuthHeader(req.headers.authorization);
  if (!basic) return null;
  if (basic.user === process.env.ADMIN_BASIC_USER && basic.pass === process.env.ADMIN_BASIC_PASS) {
    return { source: 'basic', sanitizedUser: { id: null, username: basic.user, display_name: 'basic-auth' } };
  }
  return null;
}

function verifyToken(req) {
  if (!hasTokenConfig()) return null;
  const headerToken = req.headers['x-admin-token'];
  if (typeof headerToken === 'string' && headerToken === process.env.ADMIN_TOKEN) {
    return { source: 'env_token', sanitizedUser: { id: null, username: 'env-token', display_name: 'env-token' } };
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const candidate = auth.slice(7).trim();
    if (candidate === process.env.ADMIN_TOKEN) {
      return { source: 'env_token', sanitizedUser: { id: null, username: 'env-token', display_name: 'env-token' } };
    }
  }
  return null;
}

function extractSessionToken(req) {
  const headerToken = req.headers['x-admin-session'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (!hasTokenConfig() || token !== process.env.ADMIN_TOKEN) {
      return token;
    }
  }
  return null;
}

async function getSessionContext(rawToken) {
  if (!rawToken) return null;
  const prisma = getPrisma();
  const tokenHash = hashToken(rawToken);
  const session = await prisma.adminSession.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.adminSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session;
}

function sanitizeAdminUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    display_name: user.displayName || null,
  };
}

async function createSessionForUser(userId) {
  const prisma = getPrisma();
  const token = 'sess_' + randomBytes(24).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);
  const sessionId = 'as_' + randomBytes(8).toString('hex');
  await prisma.adminSession.create({
    data: { id: sessionId, userId, tokenHash, expiresAt },
  });
  return { token, expiresAt };
}

async function loginAdminWithPassword(username, password) {
  const prisma = getPrisma();
  if (!username || !password) return null;
  const normalized = username.trim();
  const user = await prisma.adminUser.findUnique({ where: { username: normalized } });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  const session = await createSessionForUser(user.id);
  return { token: session.token, expires_at: session.expiresAt.toISOString(), user: sanitizeAdminUser(user) };
}

async function logoutAdminSession(rawToken) {
  if (!rawToken) return;
  const prisma = getPrisma();
  const tokenHash = hashToken(rawToken);
  await prisma.adminSession.deleteMany({ where: { tokenHash } });
}

async function createAdminUserAccount({ username, password, displayName }, prismaOverride) {
  const prisma = prismaOverride || getPrisma();
  const uname = (username || '').trim();
  if (!uname) {
    throw new Error('username_required');
  }
  const pwd = (password || '').trim();
  if (pwd.length < PASSWORD_MIN_LENGTH) {
    throw new Error('password_too_short');
  }
  const existing = await prisma.adminUser.findUnique({ where: { username: uname } });
  if (existing) {
    throw new Error('username_taken');
  }
  const passwordHash = await bcrypt.hash(pwd, BCRYPT_ROUNDS);
  const id = 'admin_' + randomBytes(8).toString('hex');
  const user = await prisma.adminUser.create({
    data: {
      id,
      username: uname,
      passwordHash,
      displayName: displayName ? displayName.trim() : null,
    }
  });
  return sanitizeAdminUser(user);
}

async function listAdminUsers() {
  const prisma = getPrisma();
  const users = await prisma.adminUser.findMany({ orderBy: { createdAt: 'asc' } });
  return users.map(sanitizeAdminUser);
}

async function hasAnyAuthConfigured() {
  if (hasBasicConfig() || hasTokenConfig()) {
    return true;
  }
  try {
    const prisma = getPrisma();
    const count = await prisma.adminUser.count();
    return count > 0;
  } catch {
    return false;
  }
}

async function authenticateRequest(req) {
  const basicResult = verifyBasic(req);
  if (basicResult) {
    return { source: basicResult.source, sanitizedUser: basicResult.sanitizedUser, dbUserId: null, sessionId: null };
  }
  const tokenResult = verifyToken(req);
  if (tokenResult) {
    return { source: tokenResult.source, sanitizedUser: tokenResult.sanitizedUser, dbUserId: null, sessionId: null };
  }
  const sessionToken = extractSessionToken(req);
  if (!sessionToken) return null;
  const session = await getSessionContext(sessionToken);
  if (!session) return null;
  return {
    source: 'session',
    sanitizedUser: sanitizeAdminUser(session.user),
    dbUserId: session.user.id,
    sessionId: session.id,
  };
}

async function requireAdminAuth(req, res, next) {
  try {
    const ctx = await authenticateRequest(req);
    if (ctx) {
      req.adminUser = ctx.sanitizedUser;
      req.adminAuthSource = ctx.source;
      req.adminDbUserId = ctx.dbUserId || null;
      req.adminSessionId = ctx.sessionId || null;
      return next();
    }
    const configured = await hasAnyAuthConfigured();
    if (!configured) {
      return res.status(503).json({ ok: false, error: 'admin_auth_not_configured' });
    }
    if (hasBasicConfig()) {
      res.set('WWW-Authenticate', 'Basic realm="kintone-admin"');
    }
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  requireAdminAuth,
  loginAdminWithPassword,
  logoutAdminSession,
  createAdminUserAccount,
  listAdminUsers,
  sanitizeAdminUser,
  extractSessionToken,
};
