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

async function kintoneGetById(tenant, app, recordId) {
  const cfg = await getAppConfig(tenant, app);
  const client = buildClient(cfg.domain, cfg.apiToken);
  try {
    const resp = await client.get('/k/v1/record.json', {
      params: { app: cfg.appId, id: Number(recordId) },
    });
    const record = (resp.data && resp.data.record) || null;
    if (!record) {
      const e = new Error('record_not_found');
      e.status = 404;
      throw e;
    }
    return {
      recordId: record.$id ? record.$id.value : String(recordId),
      revision: record.$revision ? record.$revision.value : null,
      fields: record,
    };
  } catch (error) {
    throw sanitizeError(error);
  }
}

async function kintoneUpdateById(tenant, app, recordId, payload) {
  const cfg = await getAppConfig(tenant, app);
  const client = buildClient(cfg.domain, cfg.apiToken);
  try {
    const resp = await client.put('/k/v1/record.json', {
      app: cfg.appId,
      id: Number(recordId),
      record: toKintoneRecord(payload),
    });
    return { recordId: String(recordId), revision: resp.data.revision };
  } catch (error) {
    throw sanitizeError(error);
  }
}

async function kintoneQuery(tenant, app, query) {
  const cfg = await getAppConfig(tenant, app);
  const client = buildClient(cfg.domain, cfg.apiToken);
  const queryText = query && typeof query.query === 'string' ? query.query : '';
  try {
    const params = { app: cfg.appId };
    if (queryText.trim()) {
      params.query = queryText;
    }
    const resp = await client.get('/k/v1/records.json', {
      params,
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

async function fetchKintoneAppSchemaByConfig({ domain, appId, apiToken }) {
  const client = buildClient(domain, apiToken);
  try {
    const [formResp, viewResp] = await Promise.all([
      client.get('/k/v1/app/form/fields.json', { params: { app: appId } }),
      client.get('/k/v1/app/views.json', { params: { app: appId } }),
    ]);
    return {
      source: 'app_meta_api',
      form: formResp.data,
      views: viewResp.data,
    };
  } catch (metaError) {
    try {
      const recResp = await client.get('/k/v1/records.json', {
        params: { app: appId, query: 'order by $id desc limit 1' },
      });
      const records = (recResp.data && recResp.data.records) || [];
      const sample = records[0] || {};
      const fieldCodes = Object.keys(sample);
      const fields = fieldCodes.map((code) => ({
        code,
        type: sample[code] && sample[code].type ? sample[code].type : 'UNKNOWN',
      }));
      return {
        source: 'records_sample',
        form: {
          app: String(appId),
          properties: Object.fromEntries(
            fields.map((f) => [f.code, { type: f.type }])
          ),
        },
        views: { views: {} },
      };
    } catch (recordError) {
      throw sanitizeError(recordError || metaError);
    }
  }
}

module.exports = {
  kintoneCreate,
  kintoneGetByToken,
  kintoneUpdateByToken,
  kintoneGetById,
  kintoneUpdateById,
  kintoneQuery,
  fetchKintoneAppSchemaByConfig,
};
