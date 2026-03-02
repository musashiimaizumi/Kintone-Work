const axios = require('axios');
const { getPrisma } = require('./db');
const { decryptSecret } = require('./util');

const tokenField = process.env.KINTONE_TOKEN_FIELD || 'token';
const timeoutMs = Number(process.env.KINTONE_TIMEOUT_MS || 10000);

function sanitizeError(error) {
  if (error.response) {
    const status = error.response.status;
    const code = error.response.data && error.response.data.code ? error.response.data.code : 'kintone_error';
    const e = new Error(code);
    e.status = status;
    return e;
  }
  const e = new Error(error.message || 'kintone_network_error');
  e.status = 502;
  return e;
}

function toKintoneRecord(payload) {
  const out = {};
  const src = payload || {};
  Object.keys(src).forEach((fieldCode) => {
    const v = src[fieldCode];
    if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'value')) {
      out[fieldCode] = v;
    } else {
      out[fieldCode] = { value: v };
    }
  });
  return out;
}

function escapeKintoneQueryValue(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function getAppConfig(tenant, app) {
  const prisma = getPrisma();
  const appCfg = await prisma.app.findUnique({ where: { id: app } });
  if (!appCfg || appCfg.tenantId !== tenant) {
    const e = new Error('app_not_found');
    e.status = 404;
    throw e;
  }
  const domain = appCfg.kintoneDomain;
  const appId = Number(appCfg.appCode);
  if (!domain || Number.isNaN(appId)) {
    const e = new Error('invalid_app_config');
    e.status = 400;
    throw e;
  }
  let apiToken = appCfg.apiTokenEnc || process.env.KINTONE_API_TOKEN || '';
  if (!apiToken) {
    const e = new Error('kintone_api_token_missing');
    e.status = 400;
    throw e;
  }
  apiToken = decryptSecret(apiToken);
  return { domain, appId, apiToken };
}

function buildClient(domain, apiToken) {
  return axios.create({
    baseURL: `https://${domain}`,
    timeout: timeoutMs,
    headers: {
      'X-Cybozu-API-Token': apiToken,
      'Content-Type': 'application/json',
    },
  });
}

async function kintoneCreate(tenant, app, payload) {
  const cfg = await getAppConfig(tenant, app);
  const client = buildClient(cfg.domain, cfg.apiToken);
  try {
    const resp = await client.post('/k/v1/record.json', {
      app: cfg.appId,
      record: toKintoneRecord(payload),
    });
    return { recordId: resp.data.id, revision: resp.data.revision };
  } catch (error) {
    throw sanitizeError(error);
  }
}

async function kintoneGetByToken(tenant, app, token) {
  const cfg = await getAppConfig(tenant, app);
  const client = buildClient(cfg.domain, cfg.apiToken);
  const q = `${tokenField} = "${escapeKintoneQueryValue(token)}" order by $id desc limit 1`;
  try {
    const resp = await client.get('/k/v1/records.json', { params: { app: cfg.appId, query: q } });
    const records = (resp.data && resp.data.records) || [];
    if (!records.length) {
      const e = new Error('record_not_found');
      e.status = 404;
      throw e;
    }
    const record = records[0];
    return {
      recordId: record.$id ? record.$id.value : null,
      revision: record.$revision ? record.$revision.value : null,
      fields: record,
    };
  } catch (error) {
    throw sanitizeError(error);
  }
}

async function kintoneUpdateByToken(tenant, app, token, payload) {
  const cfg = await getAppConfig(tenant, app);
  const client = buildClient(cfg.domain, cfg.apiToken);
  const found = await kintoneGetByToken(tenant, app, token);
  try {
    const resp = await client.put('/k/v1/record.json', {
      app: cfg.appId,
      id: Number(found.recordId),
      record: toKintoneRecord(payload),
    });
    return { recordId: found.recordId, revision: resp.data.revision };
  } catch (error) {
    throw sanitizeError(error);
  }
}

async function kintoneQuery(tenant, app, query) {
  const cfg = await getAppConfig(tenant, app);
  const client = buildClient(cfg.domain, cfg.apiToken);
  const queryText = query && typeof query.query === 'string' ? query.query : '';
  try {
    const resp = await client.get('/k/v1/records.json', {
      params: { app: cfg.appId, query: queryText },
    });
    const records = (resp.data && resp.data.records) || [];
    const items = records.map((r) => ({
      id: r.$id ? r.$id.value : null,
      revision: r.$revision ? r.$revision.value : null,
      fields: r,
    }));
    return { items };
  } catch (error) {
    throw sanitizeError(error);
  }
}

module.exports = { kintoneCreate, kintoneGetByToken, kintoneUpdateByToken, kintoneQuery };
