import type { ForecastItem, LayoutConfig, LayoutItem, MetricItem, RenderData, TextItem } from './types.js'
import { escapeXml, formatTime, interpolate, interpolateRaw } from './formatters.js'
import sharp from 'sharp'

export function renderSvg(config: LayoutConfig, data: RenderData): string {
  const { frame } = config
  const items = config.items.map((item, index) => renderItem(item, data, frame.foreground, index)).join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}" role="img">
  <rect width="100%" height="100%" fill="${frame.background}" />
  <style>
    text { font-family: ${frame.fontFamily}; fill: ${frame.foreground}; dominant-baseline: hanging; }
    .muted { fill: #555; }
  </style>
  ${items}
</svg>`
}

export function renderHtml(config: LayoutConfig, svg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>TRMNL HA Layout</title><style>body{margin:0;background:#ddd;display:grid;place-items:center;min-height:100vh}.frame{width:${config.frame.width}px;height:${config.frame.height}px;background:white;box-shadow:0 2px 16px #999}</style></head><body><div class="frame">${svg}</div></body></html>`
}

export async function renderPng(config: LayoutConfig, svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg))
    .resize(config.frame.width, config.frame.height, { fit: 'fill' })
    .png()
    .toBuffer()
}

export function renderEditorHtml(bootstrapToken = ''): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>TRMNL Layout Editor</title>
  <style>
    *{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f0f2f5;color:#111}
    header{display:flex;gap:10px;align-items:center;padding:12px 16px;background:#111;color:white}button{cursor:pointer}
    main{display:grid;grid-template-columns:824px minmax(320px,1fr);gap:16px;padding:16px;align-items:start}.stage-wrap{width:824px}.stage-label{margin:0 0 8px;color:#444}
    #stage{position:relative;width:800px;height:480px;background:white;border:1px solid #111;overflow:hidden;box-shadow:0 2px 14px #bbb}
    #preview-frame{position:absolute;inset:0;width:800px;height:480px;border:0;display:block;background:white;pointer-events:none}
    #overlay{position:absolute;inset:0;width:800px;height:480px}
    .item{position:absolute;border:1px solid rgba(20,20,20,.12);background:rgba(255,255,255,.015);overflow:visible;touch-action:none;user-select:none}
    .item:hover{border-color:rgba(20,20,20,.28);background:rgba(255,255,255,.04)}
    .item-preview{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-start;overflow:hidden;padding:0 2px;color:#111;font-family:Arial,Helvetica,sans-serif;pointer-events:none}.item-preview.metric{padding:8px 12px;background:#f7f7f7;border:1px solid #111;border-radius:10px}.item-preview .muted{color:#555;font-size:18px}.item-preview .metric-value{font-weight:700;margin-top:4px}
    .item-label{display:none;position:absolute;left:2px;top:-18px;max-width:calc(100% - 4px);padding:1px 4px;border-radius:3px;background:rgba(255,255,255,.82);color:rgba(0,0,0,.68);font-size:10px;font-weight:600;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.12)}
    .item:hover .item-label,.item.selected .item-label{display:block}
    .item.selected{border:2px solid #0b69ff;background:rgba(11,105,255,.04);box-shadow:0 0 0 2px rgba(11,105,255,.18)}.item.selected .item-label{background:rgba(11,105,255,.9);color:white}
    .resize{display:none;position:absolute;right:-5px;bottom:-5px;width:12px;height:12px;background:#0b69ff;border:2px solid white;box-shadow:0 0 0 1px #0b69ff}
    .item:hover .resize,.item.selected .resize{display:block}
    aside{background:white;border:1px solid #ddd;border-radius:8px;padding:14px;min-width:300px}label{display:block;margin:8px 0 3px;font-weight:600}
    input,select,textarea{width:100%;padding:6px;border:1px solid #bbb;border-radius:4px}textarea{min-height:64px}.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .actions{display:flex;gap:8px;flex-wrap:wrap}pre{white-space:pre-wrap;background:#f7f7f7;padding:8px;border-radius:4px;max-height:120px;overflow:auto}
    .add-panel{border:2px solid #0b69ff;border-radius:8px;background:#fafcff;box-shadow:0 2px 10px rgba(11,105,255,.12)}.add-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #d9e2ee;font-weight:700}.add-body{padding:12px 14px}.tabs{display:flex;gap:6px;margin-bottom:10px}.tab{border:1px solid #bbb;background:#eee;border-radius:4px;padding:5px 10px}.tab.active{background:#0b69ff;color:white;border-color:#0b69ff}
    details.settings{margin-top:12px;border:1px solid #ddd;border-radius:8px;background:#fafafa}details.settings>summary{cursor:pointer;padding:10px 14px;font-weight:700;border-radius:8px}details.settings[open]>summary{border-bottom:1px solid #ddd}
    .settings-body{padding:12px 14px}.section-title{margin:14px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#666}.section-title:first-child{margin-top:0}
    .hint{color:#777;font-size:12px;margin-top:2px}
    .pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}.pill.ok{background:#e6f4ea;color:#1a7f37}.pill.warn{background:#fff4e0;color:#b25a00}.pill.bad{background:#fce8e6;color:#c5221f}
    .auth-block{margin-top:8px;padding:10px;border:1px dashed #ccc;border-radius:6px;background:white}
    .auth-options{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:6px}.auth-options .col{border:1px solid #eee;border-radius:6px;padding:8px}
    button.primary{background:#0b69ff;color:white;border:0;padding:6px 12px;border-radius:4px}button.secondary{background:#eee;border:0;padding:6px 12px;border-radius:4px}button.danger{background:#c5221f;color:white;border:0;padding:6px 12px;border-radius:4px}
    .hidden{display:none}
    .token-row{display:flex;gap:6px;align-items:center}.token-row input{flex:1}
    .settings-advanced{margin:8px 0;border:1px solid #eee;border-radius:6px;background:#fafafa}.settings-advanced>summary{cursor:pointer;padding:6px 10px;font-size:13px;color:#666}.settings-advanced[open]>summary{border-bottom:1px solid #eee}.settings-advanced{padding:0 10px 8px}
  </style>
</head>
<body>
  <header><strong>TRMNL Layout Editor</strong><button id="add-field" class="primary">+ Add field</button><button id="reload">Reload</button><button id="reset">Reset local changes</button><button id="save">Save</button><a style="color:white" href="/preview" target="_blank">Preview</a><a style="color:white" href="/screen.png?sample=1" target="_blank">PNG</a></header>
  <main>
    <section class="stage-wrap"><p class="stage-label">Seeed Studio TRMNL OG frame, 800×480</p><div id="stage"><img id="preview-frame" src="/screen.svg?sample=1" alt="Rendered sample preview"><div id="overlay"></div></div></section>
    <aside>
      <div id="edit-panel"><h2>Selected item</h2><div id="empty">Select an item to edit it.</div><form id="form" hidden></form></div>
      <div id="add-panel" class="add-panel" hidden></div>
      <details class="settings" open><summary>Connection Settings</summary><div class="settings-body" id="settings-body"><p class="hint">Loading settings…</p></div></details>
      <h3>Status</h3><pre id="status">Loading...</pre>
    </aside>
  </main>
  <script>
    const stage = document.getElementById('stage');
    const overlay = document.getElementById('overlay');
    const previewFrame = document.getElementById('preview-frame');
    const form = document.getElementById('form');
    const empty = document.getElementById('empty');
    const editPanel = document.getElementById('edit-panel');
    const addPanel = document.getElementById('add-panel');
    const statusEl = document.getElementById('status');
    const settingsBody = document.getElementById('settings-body');
    let config, loadedConfig, selectedId, drag, addMode = false, addType = 'text';
    const addedIds = new Set();
    const settingsToken = sessionStorage.getItem('trmnl_settings_token') || ${JSON.stringify(bootstrapToken)};
    if (settingsToken) sessionStorage.setItem('trmnl_settings_token', settingsToken);
    function authHeaders(extra) { const h = Object.assign({}, extra || {}); if (settingsToken) h['Authorization'] = 'Bearer ' + settingsToken; return h; }
    const fields = ['id','type','x','y','width','height','fontSize','weight','align','text','label','value','source','maxItems','rowHeight','timeX','tempX','precipX','conditionX','conditionFontSize','timeWeight','tempWeight','precipWeight','conditionWeight','rowDivider','dividerInset','rowPaddingY'];
    const numericFields = new Set(['x','y','width','height','fontSize','weight','maxItems','rowHeight','timeX','tempX','precipX','conditionX','conditionFontSize','timeWeight','tempWeight','precipWeight','conditionWeight','dividerInset','rowPaddingY']);
    function refreshPreview() {
      previewFrame.src = '/screen.svg?sample=1&t=' + Date.now();
    }
    async function loadConfig() {
      status('Loading layout...');
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error(await res.text());
      config = await res.json();
      loadedConfig = clone(config);
      addedIds.clear();
      selectedId = config.items[0]?.id;
      render();
      status('Loaded layout.');
    }
    function selected() { return config.items.find(i => i.id === selectedId); }
    function setAddMode(active) {
      addMode = active;
      editPanel.hidden = active;
      addPanel.hidden = !active;
      if (active) renderAddPanel();
      else renderForm();
    }
    function render() {
      overlay.innerHTML = '';
      stage.style.background = config.frame.background || '#fff';
      config.items.forEach(item => {
        const el = document.createElement('div');
        el.className = 'item' + (item.id === selectedId ? ' selected' : '');
        el.style.left = item.x + 'px';
        el.style.top = item.y + 'px';
        el.style.width = item.width + 'px';
        el.style.height = item.height + 'px';
        el.title = labelFor(item);
        const label = document.createElement('span');
        label.className = 'item-label';
        label.textContent = labelFor(item);
        el.appendChild(label);
        if (addedIds.has(item.id)) el.appendChild(previewFor(item));
        el.dataset.id = item.id;
        const handle = document.createElement('div');
        handle.className = 'resize';
        handle.dataset.resize = '1';
        el.appendChild(handle);
        overlay.appendChild(el);
      });
      if (addMode) renderAddPanel(); else renderForm();
    }
    function labelFor(item) {
      if (item.type === 'text') return item.id + ' · text';
      if (item.type === 'metric') return item.id + ' · metric';
      if (item.type === 'forecast') return 'Forecast: ' + (item.source || '');
      return item.id;
    }
    function previewFor(item) {
      const preview = document.createElement('div');
      preview.className = 'item-preview' + (item.type === 'metric' ? ' metric' : '');
      if (item.type === 'metric') {
        const label = document.createElement('div');
        label.className = 'muted';
        label.textContent = item.label || '';
        const value = document.createElement('div');
        value.className = 'metric-value';
        value.style.fontSize = (item.fontSize || 30) + 'px';
        value.textContent = item.value || '';
        preview.appendChild(label);
        preview.appendChild(value);
      } else if (item.type === 'text') {
        preview.style.fontSize = (item.fontSize || 18) + 'px';
        preview.style.fontWeight = item.weight || 400;
        preview.style.textAlign = item.align || 'left';
        preview.textContent = item.text || '';
      }
      return preview;
    }
    function renderForm() {
      if (addMode) return;
      const item = selected();
      empty.hidden = !!item;
      form.hidden = !item;
      if (!item) return;
      form.innerHTML = fields.filter(f => f in item || commonField(f, item)).map(fieldHtml).join('')
        + '<div class="actions" style="margin-top:12px"><button class="danger" id="delete-field" type="button">Delete field</button></div>';
      form.querySelectorAll('input,select,textarea').forEach(input => input.addEventListener('input', updateFromForm));
      document.getElementById('delete-field').onclick = deleteSelectedField;
    }
    function renderAddPanel() {
      const sensor = addType === 'sensor';
      addPanel.innerHTML = '<div class="add-head"><span>Add field</span><button class="secondary" id="cancel-add">Cancel</button></div>'
        + '<div class="add-body">'
        + '<div class="tabs"><button class="tab '+(!sensor?'active':'')+'" data-add-type="text" type="button">Static text</button><button class="tab '+(sensor?'active':'')+'" data-add-type="sensor" type="button">Sensor value</button></div>'
        + (sensor
          ? '<label>Label</label><input id="new-label" value="Sensor"><label>Home Assistant entity id</label><input id="new-entity" placeholder="sensor.outdoor_temperature"><label>Source key</label><input id="new-source" placeholder="outdoorTemperature"><div class="hint">Adds a metric item and data.entities mapping. The value renders as {{ sourceKey }} through the existing pipeline.</div>'
          : '<label>Visible text</label><input id="new-text" value="New text"><div class="hint">Adds a normal text item. You can edit, drag, resize, and save it like existing text fields.</div>')
        + '<div class="actions" style="margin-top:12px"><button class="primary" id="create-field" type="button">Create field</button></div>'
        + '</div>';
      addPanel.querySelectorAll('[data-add-type]').forEach(button => button.addEventListener('click', () => { addType = button.dataset.addType; renderAddPanel(); }));
      document.getElementById('cancel-add').onclick = () => setAddMode(false);
      document.getElementById('create-field').onclick = createField;
    }
    function commonField(name, item) { return ['x','y','width','height','fontSize','weight','align'].includes(name) && item.type !== 'line'; }
    function fieldHtml(name) {
      const item = selected();
      const value = item[name] ?? '';
      if (name === 'type' || name === 'id') return '<label>'+name+'</label><input name="'+name+'" value="'+escapeHtml(value)+'" disabled>';
      if (name === 'align') return '<label>align</label><select name="align"><option></option>'+['left','center','right'].map(v => '<option '+(value===v?'selected':'')+'>'+v+'</option>').join('')+'</select>';
      if (name === 'rowDivider') return '<label>rowDivider</label><select name="rowDivider"><option value=""></option><option value="true" '+(value===true?'selected':'')+'>true</option><option value="false" '+(value===false?'selected':'')+'>false</option></select>';
      if (['text','label','value','source'].includes(name)) return '<label>'+name+'</label><textarea name="'+name+'">'+escapeHtml(value)+'</textarea>';
      return '<label>'+name+'</label><input name="'+name+'" type="number" value="'+escapeHtml(value)+'">';
    }
    function updateFromForm(event) {
      const item = selected();
      const name = event.target.name;
      if (!name || name === 'id' || name === 'type') return;
      const raw = event.target.value;
      if (raw === '') delete item[name];
      else if (name === 'rowDivider') item[name] = raw === 'true';
      else if (numericFields.has(name)) item[name] = Number(raw);
      else item[name] = raw;
      clamp(item);
      render();
    }
    function deleteSelectedField() {
      const item = selected();
      if (!item) return;
      if (!confirm('Delete field "' + item.id + '"? Save afterward to persist this change.')) return;
      const index = config.items.findIndex(entry => entry.id === item.id);
      if (index < 0) return;
      config.items.splice(index, 1);
      addedIds.delete(item.id);
      removeUnusedEntities(referencedSources(item));
      selectedId = config.items[Math.min(index, config.items.length - 1)]?.id ?? config.items[index - 1]?.id;
      drag = null;
      render();
      status('Deleted field. Save to persist it to runtime YAML.');
    }
    function removeUnusedEntities(sources) {
      if (!config.data || !config.data.entities) return;
      for (const source of sources) {
        if (source in config.data.entities && !sourceStillReferenced(source)) {
          delete config.data.entities[source];
          if (config.data.selectors) delete config.data.selectors[source];
        }
      }
      if (config.data.selectors && !Object.keys(config.data.selectors).length) delete config.data.selectors;
    }
    function sourceStillReferenced(source) {
      return config.items.some(item => referencedSources(item).has(source));
    }
    function referencedSources(item) {
      const sources = new Set();
      for (const value of Object.values(item)) {
        if (typeof value !== 'string') continue;
        const pattern = /{{\\s*([a-zA-Z_][a-zA-Z0-9_]*)/g;
        let match;
        while ((match = pattern.exec(value))) sources.add(match[1]);
      }
      if (item.type === 'forecast' && item.source) sources.add(item.source);
      return sources;
    }
    function createField() {
      const created = addType === 'sensor' ? createSensorField() : createTextField();
      if (!created) return;
      setAddMode(false);
      render();
      status('Added field. Save to persist it to runtime YAML.');
    }
    function createTextField() {
      const text = document.getElementById('new-text').value.trim() || 'New text';
      const id = uniqueKey(slug(text) || 'text', existingItemIds());
      const item = { id, type:'text', x:32, y:120, width:220, height:34, fontSize:24, weight:700, text };
      config.items.push(item);
      addedIds.add(id);
      selectedId = id;
      clamp(item);
      return true;
    }
    function createSensorField() {
      const label = document.getElementById('new-label').value.trim() || 'Sensor';
      const entity = document.getElementById('new-entity').value.trim();
      const requestedSource = document.getElementById('new-source').value.trim();
      if (!entity) { status('Enter a Home Assistant entity id before creating a sensor field.'); return false; }
      const source = uniqueKey(camelKey(requestedSource || label || entity) || 'sensor', existingSourceKeys());
      config.data = config.data || {};
      config.data.entities = config.data.entities || {};
      config.data.entities[source] = entity;
      const id = uniqueKey(slug(label) || 'sensor', existingItemIds());
      const item = { id, type:'metric', x:32, y:120, width:180, height:62, label, fontSize:24, value:'{{ ' + source + ' }}' };
      config.items.push(item);
      addedIds.add(id);
      selectedId = id;
      clamp(item);
      return true;
    }
    function existingItemIds() { return new Set(config.items.map(item => item.id)); }
    function existingSourceKeys() { return new Set(Object.keys((config.data && config.data.entities) || {})); }
    function uniqueKey(base, existing) {
      let key = base;
      let index = 2;
      while (existing.has(key)) key = base + '-' + index++;
      existing.add(key);
      return key;
    }
    function slug(value) {
      return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    }
    function camelKey(value) {
      const words = String(value).trim().replace(/^[a-z]+\\./i, '').split(/[^a-zA-Z0-9]+/).filter(Boolean);
      if (!words.length) return '';
      return words.map((word, index) => {
        const cleaned = word.replace(/[^a-zA-Z0-9]/g, '');
        if (!cleaned) return '';
        const lower = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
        return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
      }).join('').replace(/^[^a-zA-Z_]+/, '');
    }
    function clamp(item) {
      item.x = Math.max(0, Math.min(config.frame.width - 1, Math.round(item.x)));
      item.y = Math.max(0, Math.min(config.frame.height - 1, Math.round(item.y)));
      item.width = Math.max(1, Math.min(config.frame.width - item.x, Math.round(item.width)));
      item.height = Math.max(1, Math.min(config.frame.height - item.y, Math.round(item.height)));
    }
    stage.addEventListener('pointerdown', event => {
      const el = event.target.closest('.item');
      if (!el) return;
      selectedId = el.dataset.id;
      const item = selected();
      drag = { id:selectedId, resize:event.target.dataset.resize === '1', sx:event.clientX, sy:event.clientY, x:item.x, y:item.y, w:item.width, h:item.height };
      el.setPointerCapture(event.pointerId);
      render();
    });
    stage.addEventListener('pointermove', event => {
      if (!drag) return;
      const item = selected();
      const dx = event.clientX - drag.sx, dy = event.clientY - drag.sy;
      if (drag.resize) { item.width = drag.w + dx; item.height = drag.h + dy; } else { item.x = drag.x + dx; item.y = drag.y + dy; }
      clamp(item);
      render();
    });
    stage.addEventListener('pointerup', () => { drag = null; });
    document.getElementById('reload').onclick = () => loadConfig().catch(error => status('Load failed: ' + error.message));
    document.getElementById('add-field').onclick = () => setAddMode(true);
    document.getElementById('reset').onclick = () => {
      if (!loadedConfig) return;
      config = clone(loadedConfig);
      addedIds.clear();
      selectedId = config.items.find(i => i.id === selectedId)?.id ?? config.items[0]?.id;
      render();
      status('Reset unsaved edits.');
    };
    document.getElementById('save').onclick = async () => {
      try {
        status('Saving layout...');
        const res = await fetch('/api/config', { method:'PUT', headers: authHeaders({'Content-Type':'application/json'}), body:JSON.stringify(config) });
        if (!res.ok) throw new Error(await res.text());
        config = await res.json();
        loadedConfig = clone(config);
        addedIds.clear();
        refreshPreview();
        render();
        status('Saved layout to runtime YAML.');
      } catch (error) {
        status('Save failed: ' + error.message);
      }
    };

    async function loadSettings() {
      try {
        const res = await fetch('/api/settings', { headers: authHeaders() });
        if (!res.ok) { settingsBody.innerHTML = '<p class="hint">Could not load settings (' + res.status + ').</p>'; return; }
        const settings = await res.json();
        renderSettings(settings);
      } catch (e) { settingsBody.innerHTML = '<p class="hint">Could not load settings.</p>'; }
    }
    function relativeTime(ts) {
      if (!ts) return 'never';
      const diff = Date.now() - ts;
      if (diff < 0) return 'just now';
      const min = Math.floor(diff / 60000);
      if (min < 1) return 'just now';
      if (min < 60) return min + ' min ago';
      const hr = Math.floor(min / 60);
      if (hr < 24) return hr + ' h ago';
      return Math.floor(hr / 24) + ' d ago';
    }
    function expiryState(obtainedAt) {
      if (!obtainedAt) return null;
      const ageMin = (Date.now() - obtainedAt) / 60000;
      if (ageMin >= 30) return 'bad';
      if (ageMin >= 25) return 'warn';
      return 'ok';
    }
    function renderSettings(settings) {
      const t = settings.terminus || {};
      const mode = t.mode || 'byos-uri';
      const authModes = ['screen-content','byos-uri','byos-base64'];
      const showAuth = authModes.includes(mode);
      const showWebhook = mode === 'raw-webhook';
      const showAddonUrl = mode === 'byos-uri';
      const tokenPreview = settings.haToken ? ' (' + settings.haToken + ')' : '';
      const authed = !!t.accessToken;
      const state = expiryState(t.obtainedAt);
      const pillHtml = authed
        ? '<span class="pill ' + (state === 'bad' ? 'bad' : state === 'warn' ? 'warn' : 'ok') + '">Authenticated</span>'
          + '<span class="hint">Last refreshed: ' + relativeTime(t.obtainedAt) + (state === 'bad' ? ' · re-authentication required' : state === 'warn' ? ' · expires soon' : '') + '</span>'
        : '<span class="pill bad">Not authenticated</span>';
      const authHtml = authed
        ? '<div class="actions"><button class="secondary" id="refresh-tokens">Refresh now</button><button class="danger" id="clear-tokens">Clear tokens</button></div>'
        : '<div class="auth-options">'
          + '<div class="col"><strong>Login with credentials</strong><label>Terminus login (email)</label><input id="terminus_login" type="email" autocomplete="username"><label>Terminus password</label><input id="terminus_password" type="password" autocomplete="current-password"><button class="primary" id="login-btn">Authenticate</button></div>'
          + '<div class="col"><strong>Paste tokens manually</strong><label>Access token</label><textarea id="terminus_access_token" rows="2"></textarea><label>Refresh token</label><textarea id="terminus_refresh_token" rows="2"></textarea><button class="primary" id="save-tokens">Save tokens</button></div>'
          + '</div>';
      settingsBody.innerHTML =
        '<div class="section-title">Home Assistant</div>'
        + '<label>Home Assistant URL</label><input id="home_assistant_url" type="url" value="' + escapeHtml(settings.homeAssistantUrl || '') + '">'
        + '<label>HA long-lived token</label><div class="token-row"><input id="ha_token" type="password" placeholder="' + escapeHtml(settings.haToken || 'set to replace') + '"><span class="hint">' + escapeHtml(tokenPreview) + '</span></div>'
        + '<label>Refresh interval (seconds)</label><input id="refresh_interval_seconds" type="number" min="0" value="' + (settings.refreshIntervalSeconds ?? 0) + '"><div class="hint">0 = manual only</div>'
        + '<div class="section-title">Terminus</div>'
        + '<label>Terminus server URL</label><input id="terminus_api_url" type="url" value="' + escapeHtml(t.apiUrl || '') + '" placeholder="http://terminus:2300">'
        + '<label>Mode</label><select id="terminus_mode">' + ['screen-content','byos-uri','byos-base64','raw-webhook'].map(m => '<option value="'+m+'" '+(mode===m?'selected':'')+'>'+m+'</option>').join('') + '</select>'
        + (showAddonUrl ? '<label>Add-on URL</label><input id="public_base_url" type="url" value="' + escapeHtml(settings.publicBaseUrl || '') + '" placeholder="http://host.docker.internal:10000"><div class="hint">Required for byos-uri mode. This is the URL Terminus can use to fetch /screen.png from this dashboard, often different from the browser URL.</div>' : '')
        + '<details class="settings-advanced"><summary>Screen metadata (optional)</summary>'
        + '<label>Model ID</label><input id="terminus_model_id" type="text" value="' + escapeHtml(t.modelId || '') + '" placeholder="1">'
        + '<div class="row"><div><label>Screen name</label><input id="terminus_screen_name" type="text" value="' + escapeHtml(t.screenName || '') + '" placeholder="ha-layout"></div>'
        + '<div><label>Screen label</label><input id="terminus_screen_label" type="text" value="' + escapeHtml(t.screenLabel || '') + '" placeholder="Home Assistant Layout"></div></div>'
        + '<label>Playlist ID</label><input id="terminus_playlist_id" type="text" value="' + escapeHtml(t.playlistId || '') + '" placeholder="optional">'
        + '</details>'
        + (showWebhook ? '<label>Webhook URL</label><input id="terminus_webhook_url" type="url" value="' + escapeHtml(t.webhookUrl || '') + '">' : '')
        + (showAuth ? '<div class="section-title">JWT authentication</div><div class="auth-block">' + pillHtml + authHtml + '</div>' : '')
        + '<div class="actions" style="margin-top:12px"><button class="primary" id="save-settings">Save settings</button></div>';
      const modeSelect = document.getElementById('terminus_mode');
      if (modeSelect) modeSelect.onchange = async () => { renderSettings(await gatherSettings(false)); };
      const saveBtn = document.getElementById('save-settings');
      if (saveBtn) saveBtn.onclick = saveSettingsHandler;
      const loginBtn = document.getElementById('login-btn');
      if (loginBtn) loginBtn.onclick = terminusLogin;
      const saveTokensBtn = document.getElementById('save-tokens');
      if (saveTokensBtn) saveTokensBtn.onclick = saveTokensHandler;
      const refreshBtn = document.getElementById('refresh-tokens');
      if (refreshBtn) refreshBtn.onclick = terminusRefresh;
      const clearBtn = document.getElementById('clear-tokens');
      if (clearBtn) clearBtn.onclick = terminusClear;
    }
    async function gatherSettings(includeTokens) {
      const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
      const existing = await (await fetch('/api/settings', { headers: authHeaders() })).json();
      const t = existing.terminus || {};
      const accessToken = includeTokens ? (val('terminus_access_token') || undefined) : (t.accessToken || undefined);
      const refreshToken = includeTokens ? (val('terminus_refresh_token') || undefined) : (t.refreshToken || undefined);
      const addonUrlInput = document.getElementById('public_base_url');
      return {
        homeAssistantUrl: val('home_assistant_url'),
        haToken: val('ha_token'),
        publicBaseUrl: addonUrlInput ? val('public_base_url') : (existing.publicBaseUrl || ''),
        refreshIntervalSeconds: Number(val('refresh_interval_seconds') || 0),
        device: existing.device ?? null,
        terminus: {
          apiUrl: val('terminus_api_url'),
          mode: val('terminus_mode') || 'byos-uri',
          modelId: val('terminus_model_id') || undefined,
          screenName: val('terminus_screen_name') || undefined,
          screenLabel: val('terminus_screen_label') || undefined,
          playlistId: val('terminus_playlist_id') || undefined,
          webhookUrl: val('terminus_webhook_url') || undefined,
          accessToken,
          refreshToken,
          obtainedAt: t.obtainedAt
        }
      };
    }
    async function saveSettingsHandler() {
      try {
        const body = await gatherSettings(true);
        const res = await fetch('/api/settings', { method:'PUT', headers: authHeaders({'Content-Type':'application/json'}), body: JSON.stringify(body) });
        if (!res.ok) { const txt = await res.text(); status('Settings save failed: ' + txt); return; }
        await loadSettings();
        status('Saved settings.');
      } catch (e) { status('Settings save failed: ' + e.message); }
    }
    async function saveTokensHandler() {
      try {
        const body = await gatherSettings(true);
        body.terminus.obtainedAt = Date.now();
        const res = await fetch('/api/settings', { method:'PUT', headers: authHeaders({'Content-Type':'application/json'}), body: JSON.stringify(body) });
        if (!res.ok) { status('Save tokens failed: ' + await res.text()); return; }
        await loadSettings();
        status('Saved tokens.');
      } catch (e) { status('Save tokens failed: ' + e.message); }
    }
    async function terminusLogin() {
      try {
        const apiUrl = document.getElementById('terminus_api_url').value.trim();
        const login = document.getElementById('terminus_login').value.trim();
        const password = document.getElementById('terminus_password').value;
        const res = await fetch('/api/terminus/login', { method:'POST', headers: authHeaders({'Content-Type':'application/json'}), body: JSON.stringify({ apiUrl, login, password }) });
        const j = await res.json();
        if (!res.ok || !j.success) { status('Terminus login failed: ' + (j.error || res.status)); return; }
        await loadSettings();
        status('Authenticated with Terminus at ' + new Date(j.obtained_at).toLocaleString() + '.');
      } catch (e) { status('Terminus login failed: ' + e.message); }
    }
    async function terminusRefresh() {
      try {
        const res = await fetch('/api/terminus/refresh', { method:'POST', headers: authHeaders() });
        const j = await res.json();
        if (!res.ok || !j.success) { status('Terminus refresh failed: ' + (j.error || res.status)); return; }
        await loadSettings();
        status('Refreshed tokens at ' + new Date(j.obtained_at).toLocaleString() + '.');
      } catch (e) { status('Terminus refresh failed: ' + e.message); }
    }
    async function terminusClear() {
      try {
        const res = await fetch('/api/terminus/tokens', { method:'DELETE', headers: authHeaders() });
        if (!res.ok) { status('Clear tokens failed: ' + await res.text()); return; }
        await loadSettings();
        status('Cleared Terminus tokens.');
      } catch (e) { status('Clear tokens failed: ' + e.message); }
    }
    function status(message) { statusEl.textContent = message; }
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    loadConfig().catch(error => status(error.message));
    loadSettings();
  </script>
</body>
</html>`
}

function renderItem(item: LayoutItem, data: RenderData, color: string, index: number): string {
  switch (item.type) {
    case 'text': return renderText(item, data, index)
    case 'metric': return renderMetric(item, data, index)
    case 'forecast': return renderForecast(item, data)
    case 'line': return `<line x1="${item.x}" y1="${item.y}" x2="${item.x + item.width}" y2="${item.y + item.height}" stroke="${color}" stroke-width="1" />`
  }
}

function anchor(item: LayoutItem): string {
  if (item.align === 'center') return 'middle'
  if (item.align === 'right') return 'end'
  return 'start'
}

function textX(item: LayoutItem): number {
  if (item.align === 'center') return item.x + item.width / 2
  if (item.align === 'right') return item.x + item.width
  return item.x
}

function renderText(item: TextItem, data: RenderData, index: number): string {
  const fontSize = item.fontSize ?? 18
  const lineHeight = Math.ceil(fontSize * 1.2)
  const lines = wrapText(interpolateRaw(item.text, data.values), item.width, fontSize).slice(0, Math.max(Math.floor(item.height / lineHeight), 1))
  const clipId = `clip-${index}-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const text = lines.map((line, index) => `<text x="${textX(item)}" y="${item.y + index * lineHeight}" font-size="${fontSize}" font-weight="${item.weight ?? 400}" text-anchor="${anchor(item)}">${escapeXml(line)}</text>`).join('')
  return `<defs><clipPath id="${clipId}"><rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" /></clipPath></defs><g clip-path="url(#${clipId})">${text}</g>`
}

function renderMetric(item: MetricItem, data: RenderData, index: number): string {
  const clipId = `clip-metric-${index}-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  return `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${item.width}" height="${item.height}" rx="10" /></clipPath></defs><g clip-path="url(#${clipId})" transform="translate(${item.x},${item.y})">
    <rect width="${item.width}" height="${item.height}" rx="10" fill="#f7f7f7" stroke="#111" />
    <text x="16" y="14" font-size="18" class="muted">${escapeXml(item.label)}</text>
    <text x="16" y="46" font-size="${item.fontSize ?? 30}" font-weight="700">${interpolate(item.value, data.values)}</text>
  </g>`
}

function renderForecast(item: ForecastItem, data: RenderData): string {
  const forecast = data.states[item.source]?.attributes.forecast
  const sourceRows = Array.isArray(forecast) ? forecast.slice(0, item.maxItems ?? 8) : []
  const fontSize = item.fontSize ?? 20
  const rowHeight = item.rowHeight ?? Math.max(fontSize + 10, Math.floor(item.height / Math.max(sourceRows.length, 1)))
  const maxVisibleRows = Math.max(Math.floor(item.height / rowHeight), 0)
  const rows = sourceRows.slice(0, maxVisibleRows)
  const hasPrecipitation = rows.some((row) => precipitationValue(row as Record<string, unknown>) !== '')
  const timeX = item.timeX ?? 0
  const tempX = item.tempX ?? 70
  const precipX = item.precipX ?? 112
  const conditionX = item.conditionX ?? (hasPrecipitation ? 168 : 126)
  const conditionWidth = Math.max(item.width - conditionX - 2, 0)
  const conditionFontSize = item.conditionFontSize ?? Math.max(fontSize - 2, 12)
  const rowPaddingY = item.rowPaddingY ?? 3
  const dividerInset = item.dividerInset ?? 0
  const clipId = `clip-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const rendered = rows.map((row, index) => {
    const entry = row as Record<string, unknown>
    const y = index * rowHeight
    const time = entry.datetime ? formatTime(entry.datetime) : ''
    const temp = entry.temperature ?? entry.templow ?? '—'
    const condition = String(entry.condition ?? '').replaceAll('-', ' ')
    const precipitation = precipitationValue(entry)
    const conditionText = truncateText(condition, conditionWidth, conditionFontSize)
    const divider = item.rowDivider && index < rows.length - 1
      ? `<line x1="${dividerInset}" y1="${rowHeight - 1}" x2="${item.width - dividerInset}" y2="${rowHeight - 1}" stroke="#111" stroke-width="1" opacity="0.35" />`
      : ''
    return `<g transform="translate(0,${y})">
      <text x="${timeX}" y="${rowPaddingY}" font-size="${fontSize}" font-weight="${item.timeWeight ?? item.weight ?? 700}">${escapeXml(time)}</text>
      <text x="${tempX}" y="${rowPaddingY}" font-size="${fontSize}" font-weight="${item.tempWeight ?? item.weight ?? 700}">${escapeXml(String(temp))}°</text>
      ${hasPrecipitation ? `<text x="${precipX}" y="${rowPaddingY}" font-size="${fontSize}" font-weight="${item.precipWeight ?? 700}" class="muted">${escapeXml(precipitation)}</text>` : ''}
      <text x="${conditionX}" y="${rowPaddingY}" font-size="${conditionFontSize}" font-weight="${item.conditionWeight ?? item.weight ?? 800}" fill="#222">${escapeXml(conditionText)}</text>
      ${divider}
    </g>`
  }).join('\n')
  return `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${item.width}" height="${item.height}" /></clipPath></defs>
  <g transform="translate(${item.x},${item.y})" clip-path="url(#${clipId})">${rendered}</g>`
}

function precipitationValue(entry: Record<string, unknown>): string {
  const value = entry.precipitation_probability ?? entry.precipitationProbability ?? entry.precipitation
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'number') return `${Math.round(value)}%`
  return String(value)
}

function truncateText(text: string, maxWidth: number, fontSize: number): string {
  const maxCharacters = Math.max(Math.floor(maxWidth / (fontSize * 0.55)), 0)
  if (text.length <= maxCharacters) return text
  if (maxCharacters <= 1) return ''
  return `${text.slice(0, maxCharacters - 1)}…`
}

function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const maxCharacters = Math.max(Math.floor(maxWidth / (fontSize * 0.55)), 1)
  return text.split('\n').flatMap((paragraph) => {
    if (!paragraph) return ['']
    const lines: string[] = []
    let remaining = paragraph
    while (remaining.length > maxCharacters) {
      const breakAt = remaining.lastIndexOf(' ', maxCharacters)
      const length = breakAt > 0 ? breakAt : maxCharacters
      lines.push(remaining.slice(0, length))
      remaining = remaining.slice(length).trimStart()
    }
    lines.push(remaining)
    return lines
  })
}
