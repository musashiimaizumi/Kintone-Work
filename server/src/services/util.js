const crypto = require('crypto');

function hashToken(plaintext) {
  return crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

function encryptSecret(plaintext) {
  const keyHex = process.env.SECRET_KEY || '';
  if (!keyHex || keyHex.length !== 64) {
    // 32byteキー(hex64)が未設定の場合は保存を拒否
    throw new Error('SECRET_KEY not set or invalid length (64 hex chars required)');
  }
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:gcm:${iv.toString('hex')}:${enc.toString('hex')}:${tag.toString('hex')}`;
}

function decryptSecret(ciphertext) {
  if (!ciphertext) return '';
  if (!String(ciphertext).startsWith('enc:gcm:')) {
    return String(ciphertext);
  }
  const keyHex = process.env.SECRET_KEY || '';
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('SECRET_KEY not set or invalid length (64 hex chars required)');
  }
  const [, , ivHex, dataHex, tagHex] = String(ciphertext).split(':');
  if (!ivHex || !dataHex || !tagHex) {
    throw new Error('invalid encrypted format');
  }
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

function maskSecret(secret) {
  if (!secret) return '';
  const s = String(secret);
  const tail = s.slice(-4);
  return `••••••${tail}`;
}

module.exports = { hashToken, encryptSecret, decryptSecret, maskSecret };
