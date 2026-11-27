// Villar engine — twin lab panel (eng-8). Owner: engine. Loaded only with ?twinlab=<slotId> (on /index.html too,
// because /lab is redirected in production): the candidate twin in its slot, twin ↔ procedural in place, the
// procedural copy beside it, and live look tuning that ends in a manifest entry to paste into site/data/twins.json.
//
//   ?twinlab=armchair&glb=twins/armchair-luna-leather/tripo_h3_1_multiview_to_3d-s1.glb&yaw=0&fit=stretch
//   #look=<base64url JSON>   the look block (the panel keeps it in the URL hash, so a link reproduces the state)
const css = `
.tl{position:fixed;top:12px;right:12px;z-index:2147483000;width:330px;max-height:calc(100vh - 24px);overflow:auto;
  font:12px/1.35 system-ui,sans-serif;color:#1d1b19;background:rgba(250,248,245,.96);border:1px solid #d8d2c8;
  border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:10px 12px}
.tl h3{margin:0 0 6px;font-size:13px}.tl h4{margin:10px 0 4px;font-size:12px;color:#6b6157}
.tl .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:3px 0}
.tl input[type=text]{flex:1;min-width:0;font:11px ui-monospace,monospace;padding:3px}
.tl button{font:12px system-ui;padding:3px 7px;border:1px solid #c9c1b6;background:#fff;border-radius:6px;cursor:pointer}
.tl button.on{background:#3b2a20;color:#fff;border-color:#3b2a20}
.tl input[type=range]{flex:1}.tl label{white-space:nowrap}.tl .sw{width:16px;height:16px;border-radius:3px;border:1px solid #0003;display:inline-block}
.tl textarea{width:100%;height:110px;font:10.5px ui-monospace,monospace}.tl .mono{font:11px ui-monospace,monospace;white-space:pre-wrap;color:#4a423a}
.tl .x{float:right;border:0;background:none;font-size:15px;padding:0 2px}`;

const b64 = { enc: (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => { try { return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))); } catch { return null; } } };

export function createTwinLab({ villar, slotId }) {
  const T = villar.debug.twin, q = new URLSearchParams(location.search);
  const placed = villar.debug.furnisher.placed.get(slotId);
  if (!placed) { console.warn('[twin lab] no slot', slotId); return null; }
  const itemId = placed.item.id;
  const st = {
    glb: q.get('glb') || villar.debug.twin.twins?.entry(itemId)?.glb || '',
    yaw: Number(q.get('yaw')) || 0, fit: q.get('fit') || 'stretch', up: q.get('up') === 'z' ? 'z' : 'y',
    look: b64.dec((location.hash.match(/look=([^&]+)/) || [])[1] || '') || villar.debug.twin.twins?.entry(itemId)?.look || { rules: [], rough: null, spec: null, seam: null },
    beside: false, preview: -1, file: null, report: null,
  };
  if (!Array.isArray(st.look.rules)) st.look.rules = [];

  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const el = document.createElement('div'); el.className = 'tl'; document.body.appendChild(el);
  const h = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v); } for (const c of kids) n.append(c); return n; };

  const persist = () => { const u = new URL(location.href); u.searchParams.set('glb', st.glb); u.searchParams.set('yaw', st.yaw); u.searchParams.set('fit', st.fit); u.hash = 'look=' + b64.enc(st.look); history.replaceState(null, '', u); };
  const entryOut = () => {
    const look = T.normalise(st.look);
    const r = st.report?.twin;
    const e = { glb: st.glb || '<storage key>', v: 1, faces: r?.faces, dims: r ? { w: r.dims.w, d: r.dims.d, h: r.dims.h } : undefined, yaw: st.yaw || undefined, up: st.up === 'z' ? 'z' : undefined, fit: st.fit, tol: st.fit === 'stretch' ? 0.15 : undefined, ...(look ? { look } : {}) };
    // dims after the fit = the catalogue's (the precheck compares them); for "stretch" the fit makes them equal
    if (r && st.fit !== 'uniform') e.dims = { w: r.catalogue.w, d: r.catalogue.d, h: r.catalogue.h };
    return JSON.stringify({ [itemId]: JSON.parse(JSON.stringify(e)) }, null, 2);
  };
  let busy = false;
  async function load() {
    if (busy) return; busy = true; render();
    const src = st.file || st.glb;
    const res = await T.load(slotId, { src, entry: { yaw: st.yaw, fit: st.fit, up: st.up, force: true }, look: st.look });
    st.report = res?.error ? null : T.report(slotId);
    st.error = res?.error || null; st.ms = res?.ms ?? null;
    busy = false; persist(); render();
  }
  // one look pass per frame however fast a slider moves (the seam fix redraws the albedo texture)
  let relookQ = 0;
  const relook = () => {
    if (relookQ) return;
    relookQ = requestAnimationFrame(async () => { relookQ = 0; const r = await T.look(slotId, st.look); if (r && !r.aborted && st.report) st.report.look = r; T.preview(slotId, st.preview); persist(); renderOut(); });
  };

  // colour-key picker: the next click on the 3D view samples the twin's raw texture there
  let picking = null;
  const onDown = (e) => {
    if (!picking || e.target.closest?.('.tl')) return;
    const p = T.pick(slotId, e.clientX, e.clientY);
    e.stopImmediatePropagation(); e.preventDefault();
    const swallow = (ev) => { ev.stopImmediatePropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    if (p?.hex) picking(p);
    picking = null; render();
  };
  window.addEventListener('pointerdown', onDown, true);

  // sliders never re-render the panel while dragged (the element would be replaced under the pointer)
  const slider = (label, val, min, max, step, on) => {
    const out = h('span', { class: 'mono' }, ' ' + (+val).toFixed(step < 0.01 ? 3 : 2));
    return h('label', {}, label + ' ', h('input', { type: 'range', min, max, step, value: val, oninput: (e) => { const v = Number(e.target.value); out.textContent = ' ' + v.toFixed(step < 0.01 ? 3 : 2); on(v); } }), out);
  };
  const toggle = (label, on, fn) => h('button', { class: on ? 'on' : '', onclick: fn }, label);

  function ruleBlock(r, i) {
    const set = (k, v, re = true) => { r[k] = v; relook(); if (re) render(); };
    return h('div', {},
      h('h4', {}, `Rule ${i + 1}`, ' ', h('button', { onclick: () => { st.look.rules.splice(i, 1); relook(); render(); } }, 'remove')),
      h('div', { class: 'row' }, 'key ', h('span', { class: 'sw', style: `background:${r.key || '#fff'}` }), h('span', { class: 'mono' }, r.key || '—'),
        toggle(picking && st.pickFor === `r${i}` ? 'click the twin…' : 'pick', false, () => { st.pickFor = `r${i}`; picking = (p) => { r.key = p.hex; relook(); }; render(); }),
        ' to ', h('input', { type: 'color', value: r.to || r.key || '#5e4230', oninput: (e) => set('to', e.target.value, false) })),
      h('div', { class: 'row' }, slider('tol', r.tol ?? 0.12, 0, 0.6, 0.005, (v) => set('tol', v, false))),
      h('div', { class: 'row' }, toggle('band', !!r.band, () => set('band', r.band ? null : [0, 0.35])),
        ...(r.band ? [slider('from', r.band[0], 0, 1, 0.01, (v) => set('band', [v, Math.max(v, r.band[1])], false)), slider('to', r.band[1], 0, 1, 0.01, (v) => set('band', [Math.min(v, r.band[0]), v], false))] : [])),
      h('div', { class: 'row' }, toggle('rough range', !!r.rough, () => set('rough', r.rough ? null : [0, 1])),
        ...(r.rough ? [slider('lo', r.rough[0], 0, 1, 0.01, (v) => set('rough', [v, r.rough[1]], false)), slider('hi', r.rough[1], 0, 1, 0.01, (v) => set('rough', [r.rough[0], v], false))] : [])),
      h('div', { class: 'row' }, slider('amount', r.amount ?? 1, 0, 1, 0.01, (v) => set('amount', v, false)), slider('rough×', r.roughMul ?? 1, 0.3, 3, 0.01, (v) => set('roughMul', v, false))),
      h('div', { class: 'row' }, toggle('show mask', st.preview === i, () => { st.preview = st.preview === i ? -1 : i; T.preview(slotId, st.preview); render(); })));
  }

  let outEl = null;
  function renderOut() {
    if (!outEl) return;
    const r = st.report?.twin, L = st.report?.look || T.report(slotId)?.look;
    const lines = [];
    if (st.error) lines.push(`load failed: ${st.error.reason} ${st.error.detail || ''}`);
    if (r) {
      lines.push(`twin ${r.dims.w}×${r.dims.d}×${r.dims.h} cm (W×D×H) · catalogue ${r.catalogue.w}×${r.catalogue.d}×${r.catalogue.h}`);
      lines.push(`raw error W ${(r.err.w * 100).toFixed(1)} %  D ${(r.err.d * 100).toFixed(1)} %  H ${(r.err.h * 100).toFixed(1)} % → ${st.fit}${r.hint ? ' · ' + r.hint : ''}`);
      lines.push(`${r.faces} tris · tex ${r.texMax}px · ${r.gpuMB} MB GPU · ${r.ms?.total ?? st.ms} ms`);
    }
    if (L?.seam) lines.push('seam ' + JSON.stringify(L.seam));
    outEl.querySelector('.mono').textContent = lines.join('\n');
    outEl.querySelector('textarea').value = entryOut();
  }

  function render() {
    const lk = st.look, showing = T.showing(slotId);
    el.replaceChildren(
      h('button', { class: 'x', title: 'close', onclick: () => { el.remove(); window.removeEventListener('pointerdown', onDown, true); } }, '×'),
      h('h3', {}, `Twin lab · ${slotId} · ${itemId}`),
      h('div', { class: 'row' }, h('input', { type: 'text', value: st.glb, placeholder: 'Storage key …/model.glb', onchange: (e) => { st.glb = e.target.value.trim(); st.file = null; } }),
        h('button', { onclick: load }, busy ? '…' : 'Load')),
      h('div', { class: 'row' }, 'or file ', h('input', { type: 'file', accept: '.glb', onchange: (e) => { st.file = e.target.files?.[0] || null; if (st.file) load(); } })),
      h('div', { class: 'row' }, 'yaw', ...[0, 90, 180, 270].map((y) => toggle(String(y), st.yaw === y, () => { st.yaw = y; load(); })),
        ' fit', ...['stretch', 'exact', 'uniform'].map((f) => toggle(f, st.fit === f, () => { st.fit = f; load(); })),
        ' up', ...['y', 'z'].map((u) => toggle(u, st.up === u, () => { st.up = u; load(); }))),
      h('div', { class: 'row' }, toggle('twin', showing === 'twin', () => { T.flip(slotId, 'twin'); render(); }), toggle('procedural', showing === 'procedural', () => { T.flip(slotId, 'procedural'); render(); }),
        toggle('beside', st.beside, () => { st.beside = !st.beside; T.beside(slotId, st.beside); render(); }),
        h('button', { onclick: () => villar.focus(slotId) }, 'focus'), h('button', { onclick: () => villar.debug.controls.onFocusKey?.('ArrowLeft') }, '◀ 45°'),
        h('button', { onclick: () => villar.debug.controls.onFocusKey?.('ArrowRight') }, '45° ▶'), h('button', { onclick: () => { villar.unfocus(); villar.setView('eye'); } }, 'Entry')),
      h('h4', {}, 'Albedo rules (masked recolour)'),
      ...lk.rules.map(ruleBlock),
      lk.rules.length < 3 ? h('button', { onclick: () => { lk.rules.push({ key: '#a3653a', tol: 0.12, to: '#5e4230', amount: 1 }); relook(); render(); } }, '+ rule') : '',
      h('h4', {}, 'Surface'),
      h('div', { class: 'row' }, slider('rough ×', lk.rough?.mul ?? 1, 0.3, 3, 0.01, (v) => { lk.rough = { ...(lk.rough || { min: 0, max: 1 }), mul: v }; relook(); }),
        slider('min', lk.rough?.min ?? 0, 0, 1, 0.01, (v) => { lk.rough = { ...(lk.rough || { mul: 1, max: 1 }), min: v }; relook(); })),
      h('div', { class: 'row' }, toggle('specular', lk.spec !== null && lk.spec !== undefined, () => { lk.spec = lk.spec === null || lk.spec === undefined ? 0.6 : null; relook(); render(); }),
        ...(lk.spec !== null && lk.spec !== undefined ? [slider('spec', lk.spec, 0, 1, 0.01, (v) => { lk.spec = v; relook(); })] : [])),
      h('h4', {}, 'Seam fix (albedo texture: mirror = each point matched with its mirror image)'),
      h('div', { class: 'row' }, ...['off', 'mirror', 'level'].map((m) => toggle(m, (lk.seam?.mode || 'off') === m, () => { lk.seam = m === 'off' ? null : { axis: 'x', at: 0.5, res: 0.03, radius: 0.15, ...(lk.seam || {}), mode: m }; relook(); render(); }))),
      ...(lk.seam ? [
        h('div', { class: 'row' }, ...(lk.seam.mode === 'mirror' ? ['axis', ...['x', 'y', 'z'].map((a) => toggle(a, lk.seam.axis === a, () => { lk.seam.axis = a; relook(); render(); })), slider('at', lk.seam.at, 0, 1, 0.005, (v) => { lk.seam.at = v; relook(); }), slider('res m', lk.seam.res ?? 0.03, 0.01, 0.12, 0.005, (v) => { lk.seam.res = v; relook(); })] : [slider('radius m', lk.seam.radius, 0.04, 0.6, 0.01, (v) => { lk.seam.radius = v; relook(); })])),
        h('div', { class: 'row' }, toggle('band', !!lk.seam.band, () => { lk.seam.band = lk.seam.band ? null : [0.35, 0.65]; relook(); render(); }),
          ...(lk.seam.band ? [slider('from', lk.seam.band[0], 0, 1, 0.01, (v) => { lk.seam.band = [v, lk.seam.band[1]]; relook(); }), slider('to', lk.seam.band[1], 0, 1, 0.01, (v) => { lk.seam.band = [lk.seam.band[0], v]; relook(); })] : [])),
        h('div', { class: 'row' }, toggle('rough range', !!lk.seam.rough, () => { lk.seam.rough = lk.seam.rough ? null : [0, 0.52]; relook(); render(); }),
          ...(lk.seam.rough ? [slider('lo', lk.seam.rough[0], 0, 1, 0.01, (v) => { lk.seam.rough = [v, lk.seam.rough[1]]; relook(); }), slider('hi', lk.seam.rough[1], 0, 1, 0.01, (v) => { lk.seam.rough = [lk.seam.rough[0], v]; relook(); })] : [])),
        h('div', { class: 'row' }, 'only colour ', h('span', { class: 'sw', style: `background:${lk.seam.key || '#fff'}` }), toggle('pick', false, () => { st.pickFor = 'seam'; picking = (p) => { lk.seam.key = p.hex; lk.seam.tol = lk.seam.tol || 0.12; relook(); }; render(); }),
          slider('tol', lk.seam.tol || 0, 0, 0.6, 0.005, (v) => { lk.seam.tol = v; relook(); })),
      ] : []),
      outEl = h('div', {}, h('h4', {}, 'Report · manifest entry'), h('div', { class: 'mono' }), h('textarea', { readonly: true }),
        h('div', { class: 'row' }, h('button', { onclick: () => navigator.clipboard?.writeText(entryOut()) }, 'copy entry'), h('button', { onclick: () => navigator.clipboard?.writeText(location.href) }, 'copy link'))),
    );
    renderOut();
  }
  render();
  if (st.glb) load();
  const lab = { state: st, load, render, el };
  window.__twinLab = lab; // QA
  return lab;
}
