(function () {
  const body = document.body || {};
  const ctx = {
    tenant: body.dataset ? body.dataset.tenant : '',
    app: body.dataset ? body.dataset.app : '',
  };
  const schemaStatus = document.getElementById('schemaStatus');
  const formEl = document.getElementById('dynamicForm');
  const fieldsContainer = document.getElementById('fieldsContainer');
  const submitMsg = document.getElementById('submitMsg');
  const renderedFields = [];

  function basePath() {
    const encTenant = encodeURIComponent(ctx.tenant || '');
    const encApp = encodeURIComponent(ctx.app || '');
    return `/${encTenant}/${encApp}/form`;
  }

  function toFieldList(schema) {
    const props = schema && schema.properties ? schema.properties : {};
    return Object.keys(props).map((key) => {
      const item = props[key] || {};
      return {
        code: item.code || key,
        label: item.label || key,
        type: item.type || 'SINGLE_LINE_TEXT',
        options: item.options || item.items || {},
      };
    });
  }

  function optionEntries(options) {
    if (!options || typeof options !== 'object') return [];
    return Object.keys(options).map((key) => ({
      value: options[key] && options[key].value ? options[key].value : key,
      label: options[key] && options[key].label ? options[key].label : key,
    }));
  }

  function createElement(html) {
    const tmpl = document.createElement('template');
    tmpl.innerHTML = html.trim();
    return tmpl.content.firstElementChild;
  }

  function renderField(field) {
    const wrapper = document.createElement('div');
    wrapper.className = 'field';
    const label = document.createElement('label');
    label.textContent = field.label;
    label.setAttribute('for', `field-${field.code}`);
    wrapper.appendChild(label);

    let control;
    const type = field.type;
    const options = optionEntries(field.options);
    if (type === 'MULTI_LINE_TEXT' || type === 'RICH_TEXT') {
      control = document.createElement('textarea');
    } else if (type === 'NUMBER') {
      control = document.createElement('input');
      control.type = 'number';
    } else if (type === 'DATE') {
      control = document.createElement('input');
      control.type = 'date';
    } else if (type === 'DATETIME') {
      control = document.createElement('input');
      control.type = 'datetime-local';
    } else if (type === 'TIME') {
      control = document.createElement('input');
      control.type = 'time';
    } else if (type === 'DROP_DOWN' || type === 'RADIO_BUTTON') {
      control = document.createElement('select');
      options.forEach((opt) => {
        const optionEl = document.createElement('option');
        optionEl.value = opt.value;
        optionEl.textContent = opt.label;
        control.appendChild(optionEl);
      });
    } else if (type === 'CHECK_BOX' || type === 'MULTI_SELECT') {
      const list = document.createElement('div');
      list.className = 'option-list';
      options.forEach((opt, idx) => {
        const optId = `field-${field.code}-${idx}`;
        const optLabel = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = opt.value;
        checkbox.id = optId;
        checkbox.name = field.code;
        optLabel.htmlFor = optId;
        optLabel.appendChild(checkbox);
        const span = document.createElement('span');
        span.textContent = opt.label;
        optLabel.appendChild(span);
        list.appendChild(optLabel);
      });
      wrapper.appendChild(list);
      renderedFields.push({ code: field.code, kind: 'multi', type });
      return wrapper;
    } else {
      control = document.createElement('input');
      control.type = 'text';
    }

    control.id = `field-${field.code}`;
    control.name = field.code;
    wrapper.appendChild(control);
    renderedFields.push({ code: field.code, kind: control.tagName === 'TEXTAREA' ? 'text' : control.type, type });
    return wrapper;
  }

  function unsupportedField(type) {
    const unsupported = ['SUBTABLE', 'FILE', 'USER_SELECT', 'GROUP_SELECT', 'ORGANIZATION_SELECT'];
    return unsupported.includes(type);
  }

  function renderFields(schema) {
    const fields = toFieldList(schema).filter((f) => !unsupportedField(f.type));
    if (!fields.length) {
      schemaStatus.textContent = '対応可能なフィールドが見つかりません。フォーム定義を確認してください。';
      return;
    }
    fieldsContainer.innerHTML = '';
    renderedFields.length = 0;
    fields.forEach((field) => {
      fieldsContainer.appendChild(renderField(field));
    });
    schemaStatus.textContent = 'フィールドを入力して送信してください。';
    formEl.hidden = false;
  }

  async function loadSchema() {
    try {
      const resp = await fetch(`${basePath()}/schema`);
      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        if (resp.status === 404 || errJson.error === 'schema_not_found') {
          throw new Error('フォーム定義が未登録です。管理画面でアプリ登録時の自動取得またはスキーマ登録を行ってください。');
        }
        throw new Error(errJson.error || `フォーム定義の取得に失敗しました (${resp.status})`);
      }
      const data = await resp.json();
      if (!data || !data.form) {
        throw new Error('フォーム定義が空です');
      }
      renderFields(data.form);
    } catch (error) {
      schemaStatus.textContent = error.message || 'フォーム定義の取得に失敗しました。';
    }
  }

  formEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitMsg.textContent = '送信中です...';
    const fd = new FormData(formEl);
    const payload = {};
    renderedFields.forEach((field) => {
      if (field.kind === 'multi' || field.type === 'MULTI_SELECT' || field.type === 'CHECK_BOX') {
        const values = fd.getAll(field.code).filter((v) => v && v.length);
        payload[field.code] = values;
      } else if (field.kind === 'number') {
        const raw = fd.get(field.code);
        payload[field.code] = raw === null || raw === '' ? null : Number(raw);
      } else {
        payload[field.code] = fd.get(field.code) || '';
      }
    });
    try {
      const resp = await fetch(`${basePath()}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || '送信に失敗しました');
      }
      formEl.reset();
      submitMsg.textContent = '送信しました。Kintone側でレコードを確認してください。';
    } catch (error) {
      submitMsg.textContent = error.message || '送信時にエラーが発生しました。';
    }
  });

  loadSchema();
})();
