import type { ForecastItem, LayoutConfig, LayoutItem, MetricItem, RenderData, TextItem } from './types.js'
import { escapeXml, formatTime, interpolate } from './formatters.js'
import sharp from 'sharp'

export function renderSvg(config: LayoutConfig, data: RenderData): string {
  const { frame } = config
  const items = config.items.map((item) => renderItem(item, data, frame.foreground)).join('\n')
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

export function renderEditorHtml(): string {
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
    .item-label{display:none;position:absolute;left:2px;top:-18px;max-width:calc(100% - 4px);padding:1px 4px;border-radius:3px;background:rgba(255,255,255,.82);color:rgba(0,0,0,.68);font-size:10px;font-weight:600;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.12)}
    .item:hover .item-label,.item.selected .item-label{display:block}
    .item.selected{border:2px solid #0b69ff;background:rgba(11,105,255,.04);box-shadow:0 0 0 2px rgba(11,105,255,.18)}.item.selected .item-label{background:rgba(11,105,255,.9);color:white}
    .resize{display:none;position:absolute;right:-5px;bottom:-5px;width:12px;height:12px;background:#0b69ff;border:2px solid white;box-shadow:0 0 0 1px #0b69ff}
    .item:hover .resize,.item.selected .resize{display:block}
    aside{background:white;border:1px solid #ddd;border-radius:8px;padding:14px;min-width:300px}label{display:block;margin:8px 0 3px;font-weight:600}
    input,select,textarea{width:100%;padding:6px;border:1px solid #bbb;border-radius:4px}textarea{min-height:64px}.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .actions{display:flex;gap:8px;flex-wrap:wrap}pre{white-space:pre-wrap;background:#f7f7f7;padding:8px;border-radius:4px;max-height:120px;overflow:auto}
  </style>
</head>
<body>
  <header><strong>TRMNL Layout Editor</strong><button id="reload">Reload</button><button id="reset">Reset local changes</button><button id="save">Save</button><a style="color:white" href="/preview" target="_blank">Preview</a><a style="color:white" href="/screen.png?sample=1" target="_blank">PNG</a></header>
  <main>
    <section class="stage-wrap"><p class="stage-label">Seeed Studio TRMNL OG frame, 800×480</p><div id="stage"><img id="preview-frame" src="/screen.svg?sample=1" alt="Rendered sample preview"><div id="overlay"></div></div></section>
    <aside><h2>Selected item</h2><div id="empty">Select an item to edit it.</div><form id="form" hidden></form><h3>Status</h3><pre id="status">Loading...</pre></aside>
  </main>
  <script>
    const stage = document.getElementById('stage');
    const overlay = document.getElementById('overlay');
    const previewFrame = document.getElementById('preview-frame');
    const form = document.getElementById('form');
    const empty = document.getElementById('empty');
    const statusEl = document.getElementById('status');
    let config, loadedConfig, selectedId, drag;
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
      selectedId = config.items[0]?.id;
      render();
      status('Loaded layout.');
    }
    function selected() { return config.items.find(i => i.id === selectedId); }
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
        el.dataset.id = item.id;
        const handle = document.createElement('div');
        handle.className = 'resize';
        handle.dataset.resize = '1';
        el.appendChild(handle);
        overlay.appendChild(el);
      });
      renderForm();
    }
    function labelFor(item) {
      if (item.type === 'text') return item.id + ' · text';
      if (item.type === 'metric') return item.id + ' · metric';
      if (item.type === 'forecast') return 'Forecast: ' + (item.source || '');
      return item.id;
    }
    function renderForm() {
      const item = selected();
      empty.hidden = !!item;
      form.hidden = !item;
      if (!item) return;
      form.innerHTML = fields.filter(f => f in item || commonField(f, item)).map(fieldHtml).join('');
      form.querySelectorAll('input,select,textarea').forEach(input => input.addEventListener('input', updateFromForm));
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
    document.getElementById('reset').onclick = () => {
      if (!loadedConfig) return;
      config = clone(loadedConfig);
      selectedId = config.items.find(i => i.id === selectedId)?.id ?? config.items[0]?.id;
      render();
      status('Reset unsaved edits.');
    };
    document.getElementById('save').onclick = async () => {
      try {
        status('Saving layout...');
        const res = await fetch('/api/config', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(config) });
        if (!res.ok) throw new Error(await res.text());
        config = await res.json();
        loadedConfig = clone(config);
        refreshPreview();
        render();
        status('Saved layout to runtime YAML.');
      } catch (error) {
        status('Save failed: ' + error.message);
      }
    };
    function status(message) { statusEl.textContent = message; }
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    loadConfig().catch(error => status(error.message));
  </script>
</body>
</html>`
}

function renderItem(item: LayoutItem, data: RenderData, color: string): string {
  switch (item.type) {
    case 'text': return renderText(item, data)
    case 'metric': return renderMetric(item, data)
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

function renderText(item: TextItem, data: RenderData): string {
  return `<text x="${textX(item)}" y="${item.y}" width="${item.width}" height="${item.height}" font-size="${item.fontSize ?? 18}" font-weight="${item.weight ?? 400}" text-anchor="${anchor(item)}">${interpolate(item.text, data.values)}</text>`
}

function renderMetric(item: MetricItem, data: RenderData): string {
  return `<g transform="translate(${item.x},${item.y})">
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
