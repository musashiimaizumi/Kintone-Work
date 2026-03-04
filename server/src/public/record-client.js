(function () {
  const body = document.body || {};
  const ctx = {
    tenant: body.dataset ? body.dataset.tenant : '',
    app: body.dataset ? body.dataset.app : '',
  };
  const statusEl = document.getElementById('status');
  const resultEl = document.getElementById('result');
  const payloadJson = document.getElementById('payloadJson');
  const recordIdEl = document.getElementById('recordId');
  const tokenEl = document.getElementById('token');
  const loadByIdBtn = document.getElementById('loadByIdBtn');
  const updateByIdBtn = document.getElementById('updateByIdBtn');
  const loadByTokenBtn = document.getElementById('loadByTokenBtn');
  const updateByTokenBtn = document.getElementById('updateByTokenBtn');

  function basePath() {
    const encTenant = encodeURIComponent(ctx.tenant || '');
    const encApp = encodeURIComponent(ctx.app || '');
    return `/${encTenant}/${encApp}/record`;
  }

  function setStatus(text, kind) {
    statusEl.className = kind === 'error' ? 'err' : kind === 'ok' ? 'ok' : 'muted';
    statusEl.textContent = text;
  }

  function setResult(json) {
    resultEl.textContent = JSON.stringify(json, null, 2);
    resultEl.hidden = false;
  }

  function getPayloadObject() {
    const raw = (payloadJson.value || '').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('payload は JSON オブジェクトで入力してください。');
    }
    return parsed;
  }

  function recordIdFromUrl() {
    const search = new URLSearchParams(window.location.search);
    return search.get('record_id') || '';
  }

  async function loadById() {
    const recordId = (recordIdEl.value || '').trim();
    if (!recordId) {
      setStatus('レコードIDを入力してください。', 'error');
      return;
    }
    setStatus('レコードを取得中...', 'muted');
    try {
      const res = await fetch(`${basePath()}/id/${encodeURIComponent(recordId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `request_failed_${res.status}`);
      }
      payloadJson.value = JSON.stringify(data.data || {}, null, 2);
      setResult(data);
      setStatus('レコードを読み込みました。', 'ok');
    } catch (err) {
      setStatus(err.message || '取得に失敗しました。', 'error');
    }
  }

  async function updateById() {
    const recordId = (recordIdEl.value || '').trim();
    if (!recordId) {
      setStatus('レコードIDを入力してください。', 'error');
      return;
    }
    setStatus('更新中...', 'muted');
    try {
      const payload = getPayloadObject();
      const res = await fetch(`${basePath()}/id/${encodeURIComponent(recordId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `request_failed_${res.status}`);
      }
      setResult(data);
      setStatus('更新しました。', 'ok');
    } catch (err) {
      setStatus(err.message || '更新に失敗しました。', 'error');
    }
  }

  async function loadByToken() {
    const token = (tokenEl.value || '').trim();
    if (!token) {
      setStatus('トークンを入力してください。', 'error');
      return;
    }
    setStatus('トークン参照中...', 'muted');
    try {
      const res = await fetch(`${basePath()}/${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `request_failed_${res.status}`);
      }
      payloadJson.value = JSON.stringify(data.data || {}, null, 2);
      setResult(data);
      setStatus('トークンで読み込みました。', 'ok');
    } catch (err) {
      setStatus(err.message || '取得に失敗しました。', 'error');
    }
  }

  async function updateByToken() {
    const token = (tokenEl.value || '').trim();
    if (!token) {
      setStatus('トークンを入力してください。', 'error');
      return;
    }
    setStatus('トークン更新中...', 'muted');
    try {
      const payload = getPayloadObject();
      const res = await fetch(`${basePath()}/${encodeURIComponent(token)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `request_failed_${res.status}`);
      }
      setResult(data);
      setStatus('トークンで更新しました。', 'ok');
    } catch (err) {
      setStatus(err.message || '更新に失敗しました。', 'error');
    }
  }

  loadByIdBtn.addEventListener('click', loadById);
  updateByIdBtn.addEventListener('click', updateById);
  loadByTokenBtn.addEventListener('click', loadByToken);
  updateByTokenBtn.addEventListener('click', updateByToken);

  const initialRecordId = recordIdFromUrl();
  if (initialRecordId) {
    recordIdEl.value = initialRecordId;
    loadById();
  }
})();
