(function () {
  const body = document.body || {};
  const ctx = {
    tenant: body.dataset ? body.dataset.tenant : '',
    app: body.dataset ? body.dataset.app : '',
  };
  const statusEl = document.getElementById('status');
  const tableWrap = document.getElementById('tableWrap');
  const reloadBtn = document.getElementById('reloadBtn');
  const queryBtn = document.getElementById('queryBtn');
  const queryInput = document.getElementById('queryInput');

  function basePath() {
    const encTenant = encodeURIComponent(ctx.tenant || '');
    const encApp = encodeURIComponent(ctx.app || '');
    return `/${encTenant}/${encApp}`;
  }

  function setStatus(text, kind) {
    statusEl.className = kind === 'error' ? 'err' : kind === 'ok' ? 'ok' : 'muted';
    statusEl.textContent = text;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function compactText(value, maxLen = 80) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)}…`;
  }

  function kintoneValueToText(field) {
    if (!field || typeof field !== 'object') {
      return compactText(field);
    }
    const value = field.value;
    if (value == null) return '';

    if (field.type === 'SUBTABLE' && Array.isArray(value)) {
      return `[${value.length}行のサブテーブル]`;
    }
    if (field.type === 'FILE' && Array.isArray(value)) {
      return compactText(value.map((f) => (f && f.name) ? f.name : '').filter(Boolean).join(', '));
    }

    if (Array.isArray(value)) {
      const mapped = value.map((item) => {
        if (item == null) return '';
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return String(item);
        if (typeof item === 'object') {
          if (item.name) return String(item.name);
          if (item.code) return String(item.code);
          if (Object.prototype.hasOwnProperty.call(item, 'value')) return String(item.value);
          return JSON.stringify(item);
        }
        return String(item);
      });
      return compactText(mapped.filter(Boolean).join(', '));
    }

    if (typeof value === 'object') {
      if (value.name) return compactText(value.name);
      if (value.code) return compactText(value.code);
      return compactText(JSON.stringify(value));
    }

    return compactText(value);
  }

  function collectFieldCodes(items) {
    const codes = [];
    const seen = new Set();
    items.forEach((item) => {
      const fields = (item && item.fields && typeof item.fields === 'object') ? item.fields : {};
      Object.keys(fields).forEach((code) => {
        if (seen.has(code)) return;
        seen.add(code);
        codes.push(code);
      });
    });
    return codes;
  }

  function renderRows(items) {
    if (!items.length) {
      tableWrap.innerHTML = '<p class="muted">レコードがありません。</p>';
      return;
    }

    const fieldCodes = collectFieldCodes(items);
    const headerFields = fieldCodes.map((code) => `<th>${escapeHtml(code)}</th>`).join('');

    const rows = items.map((item) => {
      const id = item && item.id ? String(item.id) : '';
      const revision = item && item.revision ? String(item.revision) : '';
      const editLink = `${basePath()}/record/ui?record_id=${encodeURIComponent(id)}`;
      const fields = (item && item.fields && typeof item.fields === 'object') ? item.fields : {};
      const valueCells = fieldCodes.map((code) => `<td>${escapeHtml(kintoneValueToText(fields[code]))}</td>`).join('');
      return `<tr><td>${escapeHtml(id)}</td><td>${escapeHtml(revision)}</td><td><a href="${editLink}" target="_blank" rel="noopener">編集</a></td>${valueCells}</tr>`;
    }).join('');
    tableWrap.innerHTML = `<div style="overflow:auto;"><table><thead><tr><th>ID</th><th>Revision</th><th>操作</th>${headerFields}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  async function loadRecords(queryText) {
    setStatus('読み込み中...', 'muted');
    try {
      const queryParam = queryText && queryText.trim() ? `?query=${encodeURIComponent(queryText.trim())}` : '';
      const res = await fetch(`${basePath()}/viewer/data${queryParam}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `request_failed_${res.status}`);
      }
      const items = Array.isArray(data.items) ? data.items : [];
      renderRows(items);
      setStatus(`${items.length}件を表示`, 'ok');
    } catch (err) {
      tableWrap.innerHTML = '';
      setStatus(err.message || '読み込みに失敗しました。', 'error');
    }
  }

  reloadBtn.addEventListener('click', async () => {
    await loadRecords('');
  });

  queryBtn.addEventListener('click', async () => {
    await loadRecords(queryInput.value || '');
  });

  loadRecords('');
})();
