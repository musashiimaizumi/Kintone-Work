const ADMIN_TOKEN_STORAGE_KEY = 'kintone_admin_token';
const ADMIN_SESSION_STORAGE_KEY = 'kintone_admin_session';
const DEFAULT_TENANT_STORAGE_KEY = 'kintone_default_tenant';
let currentAdminUser = null;
let sessionStateKnown = false;

function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '';
}

function setAdminToken(token) {
  if (token) {
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  }
}

function getDefaultTenantId() {
  return localStorage.getItem(DEFAULT_TENANT_STORAGE_KEY) || '';
}

function setDefaultTenantId(tenantId) {
  if (tenantId) {
    localStorage.setItem(DEFAULT_TENANT_STORAGE_KEY, tenantId);
  } else {
    localStorage.removeItem(DEFAULT_TENANT_STORAGE_KEY);
  }
}

function getAdminSessionToken() {
  return localStorage.getItem(ADMIN_SESSION_STORAGE_KEY) || '';
}

function setAdminSessionToken(token) {
  if (token) {
    localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  }
}

function describeAdmin(user) {
  if (!user) return '';
  return user.display_name || user.username || '';
}

function renderLoginStatus(options = {}) {
  const status = document.getElementById('loginStatus');
  if (!status) return;
  if (options.message) {
    const cls = options.variant === 'error' ? 'err' : options.variant === 'success' ? 'ok' : 'muted';
    status.innerHTML = `<span class="${cls}">${options.message}</span>`;
    return;
  }
  if (currentAdminUser) {
    status.innerHTML = `<span class="ok">ログイン中: ${describeAdmin(currentAdminUser)}</span>`;
    return;
  }
  if (getAdminSessionToken()) {
    const variant = sessionStateKnown ? 'err' : 'muted';
    const msg = sessionStateKnown ? 'セッションが切れています。再ログインしてください。' : 'セッション確認中...';
    status.innerHTML = `<span class="${variant}">${msg}</span>`;
    return;
  }
  status.innerHTML = '<span class="muted">未ログイン（レガシートークン互換）</span>';
}

function formatAdminInfo(info) {
  if (!info) return '';
  if (info.display_name && info.username) {
    return `${info.display_name} (${info.username})`;
  }
  return info.display_name || info.username || '';
}

function humanizeError(message) {
  if (!message) return '';
  const map = {
    unauthorized: '認証に失敗しました。ログイン状態を確認してください。',
    invalid_credentials: '管理者IDまたはパスワードが違います。',
    username_taken: '指定した管理者IDは既に使用されています。',
    password_too_short: 'パスワードが短すぎます（12文字以上推奨）。',
    username_required: '管理者IDを入力してください。',
    admin_auth_not_configured: '管理者認証がまだセットアップされていません。',
    tenant_not_found: '指定したテナントは見つかりませんでした。',
    tenant_delete_failed: 'テナント削除に失敗しました。',
  };
  return map[message] || message;
}

function buildFormLink(tenantId, appId) {
  if (!tenantId || !appId) return '#';
  return `/${encodeURIComponent(tenantId)}/${encodeURIComponent(appId)}/form`;
}

function buildViewerLink(tenantId, appId) {
  if (!tenantId || !appId) return '#';
  return `/${encodeURIComponent(tenantId)}/${encodeURIComponent(appId)}/viewer/ui`;
}

function buildRecordLink(tenantId, appId) {
  if (!tenantId || !appId) return '#';
  return `/${encodeURIComponent(tenantId)}/${encodeURIComponent(appId)}/record/ui`;
}

function buildAppLinks(tenantId, appId) {
  const form = buildFormLink(tenantId, appId);
  const viewer = buildViewerLink(tenantId, appId);
  const record = buildRecordLink(tenantId, appId);
  return `<a href="${form}" target="_blank" rel="noopener">フォーム</a> / <a href="${viewer}" target="_blank" rel="noopener">一覧</a> / <a href="${record}" target="_blank" rel="noopener">レコード(トークン)</a>`;
}

function buildTenantDeleteButton(tenantId) {
  return `<button type="button" class="danger delete-tenant-btn" data-tenant-id="${tenantId}">テナント削除</button>`;
}

function applyDefaultTenantToForms(tenantId) {
  const v = tenantId || '';
  const appTenant = document.querySelector('#appForm input[name="tenant"]');
  const schemaTenant = document.querySelector('#schemaForm input[name="tenant"]');
  const tokenTenant = document.querySelector('#tokenForm input[name="tenant"]');
  const appsTenant = document.getElementById('appsTenant');
  if (appTenant && !appTenant.value) appTenant.value = v;
  if (schemaTenant && !schemaTenant.value) schemaTenant.value = v;
  if (tokenTenant && !tokenTenant.value) tokenTenant.value = v;
  if (appsTenant && !appsTenant.value) appsTenant.value = v;
}

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const sessionToken = getAdminSessionToken();
  if (sessionToken) {
    headers['X-Admin-Session'] = sessionToken;
  } else {
    const token = getAdminToken();
    if (token) headers['X-Admin-Token'] = token;
  }
  return headers;
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...buildHeaders(),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && getAdminSessionToken()) {
      setAdminSessionToken('');
      currentAdminUser = null;
      sessionStateKnown = true;
      renderLoginStatus({ message: 'セッションが無効になりました。再ログインしてください。', variant: 'error' });
    }
    throw new Error(data.error || `request failed (${res.status})`);
  }
  return data;
}

async function post(url, body) {
  return apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
}

async function deleteTenantLocally(tenantId) {
  const id = (tenantId || '').trim();
  if (!id) return;
  const ok = window.confirm(`テナント ${id} をローカルDBから削除します。Kintone側のアプリ/データは削除されません。続行しますか？`);
  if (!ok) return;
  try {
    const result = await apiFetch(`/admin/tenants/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const appsTenantInput = document.getElementById('appsTenant');
    if (getDefaultTenantId() === id) {
      setDefaultTenantId('');
      applyDefaultTenantToForms('');
    }
    if (appsTenantInput && appsTenantInput.value.trim() === id) {
      appsTenantInput.value = '';
      const appsTable = document.getElementById('appsTable');
      if (appsTable) appsTable.innerHTML = '<p class="muted">テナントを削除したため一覧をクリアしました。</p>';
    }
    const summary = `削除しました: tenant=${result.tenant_id}, apps=${result.deleted_apps}, schemas=${result.deleted_schemas}, tokens=${result.deleted_tokens}`;
    const tenantMsg = document.getElementById('tenantMsg');
    if (tenantMsg) tenantMsg.innerHTML = `<span class="ok">${summary}</span>`;
    await loadTenants();
    const allAppsTable = document.getElementById('allAppsTable');
    if (allAppsTable && allAppsTable.innerHTML && !allAppsTable.innerHTML.includes('登録済みアプリがありません。')) {
      const data = await apiFetch('/admin/apps');
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        allAppsTable.innerHTML = '<p class="muted">登録済みアプリがありません。</p>';
      } else {
        const rows = items.map(a => `<tr><td>${a.tenant_id}</td><td>${a.tenant_name || ''}</td><td>${a.id}</td><td>${a.kintone_domain}</td><td>${a.app_code}</td><td>${a.auth_type}</td><td>${a.api_token_masked || ''}</td><td>${formatAdminInfo(a.created_by_admin)}</td><td>${buildAppLinks(a.tenant_id, a.id)}</td><td>${buildTenantDeleteButton(a.tenant_id)}</td></tr>`).join('');
        allAppsTable.innerHTML = `<table><thead><tr><th>Tenant ID</th><th>Tenant Name</th><th>App ID</th><th>Domain</th><th>App</th><th>Auth</th><th>Token</th><th>登録管理者</th><th>画面リンク</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`;
      }
    }
  } catch (err) {
    const tenantMsg = document.getElementById('tenantMsg');
    if (tenantMsg) tenantMsg.innerHTML = `<span class="err">${humanizeError(err.message)}</span>`;
  }
}

const authForm = document.getElementById('authForm');
const adminTokenInput = document.getElementById('adminToken');
if (adminTokenInput) {
  adminTokenInput.value = getAdminToken();
}
if (authForm && adminTokenInput) {
  authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const token = adminTokenInput.value.trim();
    setAdminToken(token);
    document.getElementById('authMsg').innerHTML = token
      ? '<span class="ok">トークンを保存しました（ブラウザのlocalStorage）。</span>'
      : '<span class="muted">トークンをクリアしました。</span>';
  });
}

const bootstrapForm = document.getElementById('bootstrapForm');
if (bootstrapForm) {
bootstrapForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const tenantName = document.getElementById('bootstrapTenantName').value.trim();
  const bootstrapAdminUser = document.getElementById('bootstrapAdminUser').value.trim();
  const bootstrapAdminPass = document.getElementById('bootstrapAdminPass').value.trim();
  const bootstrapAdminDisplay = document.getElementById('bootstrapAdminDisplay').value.trim();
  if (!bootstrapAdminUser || !bootstrapAdminPass) {
    document.getElementById('bootstrapMsg').innerHTML = '<span class="err">管理者ID/パスワードを入力してください</span>';
    return;
  }
  try {
    const r = await apiFetch('/setup/bootstrap', {
      method: 'POST',
      body: JSON.stringify({
        tenant_name: tenantName || undefined,
        admin_username: bootstrapAdminUser,
        admin_password: bootstrapAdminPass,
        admin_display_name: bootstrapAdminDisplay || undefined,
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (r.admin_token) {
      adminTokenInput.value = r.admin_token;
      setAdminToken(r.admin_token);
    }
    if (r.tenant_id) {
      setDefaultTenantId(r.tenant_id);
      applyDefaultTenantToForms(r.tenant_id);
    }
    const loginFormUser = document.querySelector('#loginForm input[name="username"]');
    if (loginFormUser && bootstrapAdminUser) {
      loginFormUser.value = bootstrapAdminUser;
    }
    document.getElementById('bootstrapMsg').innerHTML = `<span class="ok">初期化成功: tenant_id=${r.tenant_id} / 管理者ID=${bootstrapAdminUser}</span>`;
  } catch (err) {
    document.getElementById('bootstrapMsg').innerHTML = `<span class="err">${err.message}</span>`;
  }
});
}

const loginForm = document.getElementById('loginForm');
const logoutButton = document.getElementById('logoutButton');
const adminUsersTable = document.getElementById('adminUsersTable');
const tenantsTable = document.getElementById('tenantsTable');
const loadTenantsBtn = document.getElementById('loadTenants');
if (adminUsersTable) {
  adminUsersTable.innerHTML = '<span class="muted">ログインすると一覧を表示します。</span>';
}
if (tenantsTable) {
  tenantsTable.innerHTML = '<span class="muted">「一覧取得」を押すと読み込みます。</span>';
}
if (loadTenantsBtn) {
  loadTenantsBtn.addEventListener('click', async () => {
    await loadTenants();
  });
}

if (loginForm) {
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(loginForm);
  const username = (fd.get('username') || '').trim();
  const password = fd.get('password') || '';
  if (!username || !password) {
    renderLoginStatus({ message: '管理者IDとパスワードを入力してください', variant: 'error' });
    return;
  }
  try {
    const r = await apiFetch('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (r.token) {
      setAdminSessionToken(r.token);
      currentAdminUser = r.user || null;
      sessionStateKnown = true;
      loginForm.reset();
      renderLoginStatus({ message: `ログインしました: ${describeAdmin(currentAdminUser)}`, variant: 'success' });
      await loadAdminUsers();
      await loadTenants();
    }
  } catch (err) {
    renderLoginStatus({ message: humanizeError(err.message), variant: 'error' });
  }
});
}

if (logoutButton) {
logoutButton.addEventListener('click', async () => {
  try {
    await apiFetch('/admin/auth/logout', { method: 'POST', body: '{}' });
  } catch (err) {
    // ignore logout errors to allow local cleanup
  }
  setAdminSessionToken('');
  currentAdminUser = null;
  sessionStateKnown = true;
  if (adminUsersTable) {
    adminUsersTable.innerHTML = '<span class="muted">ログインすると一覧を表示します。</span>';
  }
  renderLoginStatus({ message: 'ログアウトしました。', variant: 'info' });
});
}

const adminUserForm = document.getElementById('adminUserForm');
const adminUserMsg = document.getElementById('adminUserMsg');
const reloadAdminUsersBtn = document.getElementById('reloadAdminUsers');

if (adminUserForm) {
adminUserForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(adminUserForm);
  const body = {
    username: (fd.get('username') || '').trim(),
    display_name: (fd.get('display_name') || '').trim() || undefined,
    password: fd.get('password') || '',
  };
  if (!body.username || !body.password) {
    adminUserMsg.innerHTML = '<span class="err">管理者IDとパスワードを入力してください</span>';
    return;
  }
  try {
    const r = await post('/admin/users', body);
    adminUserForm.reset();
    adminUserMsg.innerHTML = `<span class="ok">追加しました: ${r.user.username}</span>`;
    await loadAdminUsers();
  } catch (err) {
    adminUserMsg.innerHTML = `<span class="err">${humanizeError(err.message)}</span>`;
  }
});
}

if (reloadAdminUsersBtn) {
  reloadAdminUsersBtn.addEventListener('click', async () => {
    await loadAdminUsers();
  });
}

const tenantForm = document.getElementById('tenantForm');
if (tenantForm) {
tenantForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(tenantForm);
  const body = { name: fd.get('name') };
  try {
    const r = await post('/admin/tenants', body);
    if (r.tenant_id) {
      setDefaultTenantId(r.tenant_id);
      applyDefaultTenantToForms(r.tenant_id);
    }
    document.getElementById('tenantMsg').innerHTML = `<span class="ok">作成成功: ${r.tenant_id}</span>`;
  } catch (err) {
    document.getElementById('tenantMsg').innerHTML = `<span class="err">${err.message}</span>`;
  }
});
}

const appForm = document.getElementById('appForm');
if (appForm) {
appForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(appForm);
  const tenant = fd.get('tenant');
  const body = {
    kintone_domain: fd.get('kintone_domain'),
    app_code: fd.get('app_code'),
    auth_type: fd.get('auth_type'),
    api_token_enc: fd.get('api_token') || undefined,
    auto_schema: true,
  };
  try {
    const r = await post(`/admin/tenants/${tenant}/apps`, body);
    const details = [];
    details.push(`<span class="ok">登録成功: ${r.app_id}</span>`);
    if (r.schema) {
      details.push(`<div class="muted">スキーマ取得元: ${r.schema.source}</div>`);
      details.push(`<details><summary>取得スキーマを表示</summary><pre>${JSON.stringify(r.schema, null, 2)}</pre></details>`);
    }
    if (r.schema_error) {
      details.push(`<div class="err">スキーマ自動取得失敗: ${r.schema_error}</div>`);
    }
    document.getElementById('appMsg').innerHTML = details.join('');
  } catch (err) {
    document.getElementById('appMsg').innerHTML = `<span class="err">${err.message}</span>`;
  }
});
}

const schemaForm = document.getElementById('schemaForm');
if (schemaForm) {
schemaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(schemaForm);
  const tenant = fd.get('tenant');
  const app_id = fd.get('app_id');
  const type = fd.get('type');
  let json;
  try {
    json = JSON.parse(fd.get('json'));
  } catch (e2) {
    document.getElementById('schemaMsg').innerHTML = '<span class="err">JSON不正</span>';
    return;
  }
  try {
    const url = type === 'form' ? `/admin/tenants/${tenant}/schemas/forms` : `/admin/tenants/${tenant}/schemas/views`;
    const r = await post(url, { app_id, json });
    document.getElementById('schemaMsg').innerHTML = `<span class="ok">登録成功: ${r.schema_id}</span>`;
  } catch (err) {
    document.getElementById('schemaMsg').innerHTML = `<span class="err">${err.message}</span>`;
  }
});
}

const tokenForm = document.getElementById('tokenForm');
if (tokenForm) {
tokenForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(tokenForm);
  const tenant = fd.get('tenant');
  const app = fd.get('app');
  const body = {
    scope: fd.get('scope'),
    expiry_minutes: Number(fd.get('expiry_minutes')),
    record_ref: fd.get('record_ref') || undefined,
  };
  try {
    const r = await post(`/admin/tenants/${tenant}/apps/${app}/tokens`, body);
    document.getElementById('tokenMsg').innerHTML = `<span class="ok">発行成功: token=${r.token}</span>`;
  } catch (err) {
    document.getElementById('tokenMsg').innerHTML = `<span class="err">${err.message}</span>`;
  }
});
}

const loadAppsButton = document.getElementById('loadApps');
if (loadAppsButton) {
loadAppsButton.addEventListener('click', async () => {
  const tenant = document.getElementById('appsTenant').value.trim();
  if (!tenant) {
    document.getElementById('appsTable').innerHTML = '<p class="err">テナントIDを入力してください</p>';
    return;
  }
  try {
    const data = await apiFetch(`/admin/tenants/${tenant}/apps`);
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
      document.getElementById('appsTable').innerHTML = '<p class="muted">登録済みアプリがありません。</p>';
      return;
    }
    const rows = items.map(a => `<tr><td>${a.id}</td><td>${a.kintone_domain}</td><td>${a.app_code}</td><td>${a.auth_type}</td><td>${a.api_token_masked || ''}</td><td>${formatAdminInfo(a.created_by_admin)}</td><td>${buildAppLinks(tenant, a.id)}</td><td>${buildTenantDeleteButton(tenant)}</td></tr>`).join('');
    const table = `<table><thead><tr><th>ID</th><th>Domain</th><th>App</th><th>Auth</th><th>Token</th><th>登録管理者</th><th>画面リンク</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`;
    document.getElementById('appsTable').innerHTML = table;
  } catch (err) {
    document.getElementById('appsTable').innerHTML = `<p class="err">${humanizeError(err.message)}</p>`;
  }
});
}

const loadAllAppsButton = document.getElementById('loadAllApps');
if (loadAllAppsButton) {
loadAllAppsButton.addEventListener('click', async () => {
  try {
    const data = await apiFetch('/admin/apps');
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
      document.getElementById('allAppsTable').innerHTML = '<p class="muted">登録済みアプリがありません。</p>';
      return;
    }
    const rows = items.map(a => `<tr><td>${a.tenant_id}</td><td>${a.tenant_name || ''}</td><td>${a.id}</td><td>${a.kintone_domain}</td><td>${a.app_code}</td><td>${a.auth_type}</td><td>${a.api_token_masked || ''}</td><td>${formatAdminInfo(a.created_by_admin)}</td><td>${buildAppLinks(a.tenant_id, a.id)}</td><td>${buildTenantDeleteButton(a.tenant_id)}</td></tr>`).join('');
    const table = `<table><thead><tr><th>Tenant ID</th><th>Tenant Name</th><th>App ID</th><th>Domain</th><th>App</th><th>Auth</th><th>Token</th><th>登録管理者</th><th>画面リンク</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`;
    document.getElementById('allAppsTable').innerHTML = table;
  } catch (err) {
    document.getElementById('allAppsTable').innerHTML = `<p class="err">${humanizeError(err.message)}</p>`;
  }
});
}

const allAppsTableContainer = document.getElementById('allAppsTable');
if (allAppsTableContainer) {
  allAppsTableContainer.addEventListener('click', async (event) => {
    const btn = event.target && event.target.closest ? event.target.closest('.delete-tenant-btn') : null;
    if (!btn) return;
    await deleteTenantLocally(btn.getAttribute('data-tenant-id'));
  });
}

const appsTableContainer = document.getElementById('appsTable');
if (appsTableContainer) {
  appsTableContainer.addEventListener('click', async (event) => {
    const btn = event.target && event.target.closest ? event.target.closest('.delete-tenant-btn') : null;
    if (!btn) return;
    await deleteTenantLocally(btn.getAttribute('data-tenant-id'));
  });
}

async function loadAdminUsers() {
  if (!adminUsersTable) return;
  if (!getAdminSessionToken() && !getAdminToken()) {
    adminUsersTable.innerHTML = '<span class="muted">認証後に表示されます。</span>';
    return;
  }
  try {
    const data = await apiFetch('/admin/users');
    if (!data.items || data.items.length === 0) {
      adminUsersTable.innerHTML = '<span class="muted">登録済み管理者はまだありません。</span>';
      return;
    }
    const rows = data.items.map(u => `<tr><td>${u.username}</td><td>${u.display_name || ''}</td><td>${u.id}</td></tr>`).join('');
    adminUsersTable.innerHTML = `<table><thead><tr><th>管理者ID</th><th>表示名</th><th>ID</th></tr></thead><tbody>${rows}</tbody></table>`;
  } catch (err) {
    adminUsersTable.innerHTML = `<p class="err">${humanizeError(err.message)}</p>`;
  }
}

async function loadTenants() {
  if (!tenantsTable) return;
  tenantsTable.innerHTML = '<span class="muted">読み込み中...</span>';
  try {
    const data = await apiFetch('/admin/tenants');
    if (!data.items || !data.items.length) {
      tenantsTable.innerHTML = '<span class="muted">登録済みテナントがありません。</span>';
      return;
    }
    const cards = data.items.map((tenant) => {
      const rows = tenant.apps && tenant.apps.length
        ? tenant.apps.map((app) => `<tr><td>${app.kintone_domain}</td><td>${app.app_code}</td><td>${app.auth_type}</td><td>${buildAppLinks(tenant.id, app.id)}</td><td>${buildTenantDeleteButton(tenant.id)}</td></tr>`).join('')
        : `<tr><td colspan="5" class="muted">登録済みアプリがありません。</td></tr><tr><td colspan="5">${buildTenantDeleteButton(tenant.id)}</td></tr>`;
      return `<div class="tenant-card"><h3>${tenant.name}<small>${tenant.id}</small></h3><p class="muted">登録アプリ: ${tenant.app_count}件</p><table><thead><tr><th>Domain</th><th>App Code</th><th>Auth</th><th>画面リンク</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join('');
    tenantsTable.innerHTML = cards;
  } catch (err) {
    tenantsTable.innerHTML = `<p class="err">${humanizeError(err.message)}</p>`;
  }
}

if (tenantsTable) {
  tenantsTable.addEventListener('click', async (event) => {
    const btn = event.target && event.target.closest ? event.target.closest('.delete-tenant-btn') : null;
    if (!btn) return;
    await deleteTenantLocally(btn.getAttribute('data-tenant-id'));
  });
}

async function refreshSessionState() {
  if (!getAdminSessionToken()) {
    sessionStateKnown = true;
    currentAdminUser = null;
    renderLoginStatus();
    return;
  }
  try {
    const res = await apiFetch('/admin/auth/me');
    currentAdminUser = res.user || null;
    sessionStateKnown = true;
    renderLoginStatus();
    await loadAdminUsers();
    await loadTenants();
  } catch (err) {
    sessionStateKnown = true;
    currentAdminUser = null;
    renderLoginStatus({ message: humanizeError(err.message), variant: 'error' });
  }
}

renderLoginStatus();
applyDefaultTenantToForms(getDefaultTenantId());
refreshSessionState();

applyDefaultTenantToForms(getDefaultTenantId());
