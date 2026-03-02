const { getPrisma } = require('./db');
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

async function auditLog(entry) {
  // PIIを含む本文は受け取らない前提。必要メタのみ記録。
  const prisma = getPrisma();
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: entry.tenant || 'unknown',
        appId: entry.app || 'unknown',
        actor: entry.actor || null,
        action: entry.action,
        targetRecordRef: entry.target_record_ref || null,
        result: entry.result,
        prevHash: entry.prev_hash || null,
        clientIp: entry.client_ip || null,
        userAgent: entry.user_agent || null,
        tokenHashRef: entry.token_hash_ref || null,
        kintoneRecordId: entry.kintone_record_id || null,
        kintoneRevision: entry.kintone_revision || null,
        errorStatusCode: entry.error_status_code || null,
        errorMessageSanitized: entry.error_message_sanitized || null,
      }
    });
    // 構造化ログ（本文なし）
    logger.info({
      event: 'audit', tenant: entry.tenant, app: entry.app, action: entry.action, result: entry.result,
      client_ip: entry.client_ip, token_hash_ref: entry.token_hash_ref,
      kintone_record_id: entry.kintone_record_id, kintone_revision: entry.kintone_revision,
      error_status_code: entry.error_status_code
    }, 'audit recorded');
    return true;
  } catch (err) {
    logger.error({ err: err.message }, 'audit insert failed');
    return false;
  }
}

module.exports = { auditLog };
