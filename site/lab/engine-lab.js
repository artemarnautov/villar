// Engine lab page script (external so the production CSP allows it). Owner: engine.
import { loadData } from '/js/core/data.js';
import { createStore } from '/js/core/store.js';
import { createVillar } from '/js/engine/index.js';

const q = new URLSearchParams(location.search);
if (q.has('clean')) document.body.classList.add('clean');
const data = await loadData();
const store = createStore(data);
window.__villarStore = store; // lab/QA only
const villar = await createVillar({
  container: document.getElementById('stage'), store, ...data,
  quality: q.get('quality') || 'high',
  timeOfDay: q.get('tod') || 'day',
  view: q.get('view') || 'eye',
  adaptive: q.get('adaptive') !== '0',
  ...(q.get('tm') ? { toneMapping: q.get('tm') } : {}),
  forceQuality: q.has('force'),
  autoFocus: q.get('focus') !== '0',
  gi: q.get('gi') !== '0',
  autoExposure: q.get('ae') !== '0',
});

const bar = document.getElementById('bar');
const stat = document.getElementById('stat');
const tip = document.getElementById('tip');
const group = (items, onPick, isOn) => {
  const btns = items.map(([id, label]) => {
    const b = document.createElement('button'); b.textContent = label; b.dataset.id = id;
    b.onclick = () => { onPick(id); sync(); };
    bar.appendChild(b); return b;
  });
  const sep = document.createElement('span'); sep.className = 'sep'; bar.appendChild(sep);
  const sync = () => btns.forEach((b) => b.classList.toggle('on', isOn(b.dataset.id)));
  sync(); return sync;
};
const syncView = group([['eye', 'Вход'], ['living', 'Гостиная'], ['bed', 'Спальня'], ['dining', 'Столовая'], ['window', 'Окно'], ['top', 'План']],
  (v) => villar.setView(v), (v) => villar.view === v);
const syncTime = group([['morning', 'Утро'], ['day', 'День'], ['golden', 'Закат'], ['evening', 'Вечер']],
  (t) => villar.setTimeOfDay(t), (t) => villar.timeOfDay === t);
group([['photo', 'Фото']], () => (villar.photoActive ? villar.stopPhoto() : villar.startPhoto()), () => villar.photoActive);
group([['swap', 'Случайная замена']], () => {
  const types = Object.keys((store.style?.() || data.stylepack).slots).filter((t) => store.options(t).length > 1);
  if (!types.length) return;
  const t = types[(Math.random() * types.length) | 0];
  const opts = store.options(t).filter((it) => it.id !== store.selected(t)?.id);
  store.select(t, opts[(Math.random() * opts.length) | 0].id);
}, () => false);
const cur = { tm: villar.debug.toneMapping };
group([['neutral', 'Neutral'], ['agx', 'AgX'], ['agx-punchy', 'AgX+'], ['aces', 'ACES']], (t) => { villar.debug.setToneMapping(t); cur.tm = t; }, (t) => cur.tm === t);

villar.on('hover', (p) => {
  if (!p) { tip.style.display = 'none'; return; }
  tip.style.display = 'block';
  tip.style.left = p.x + 14 + 'px'; tip.style.top = p.y + 14 + 'px';
  tip.textContent = `${p.item.name} · ${p.item.price} AED`;
});
villar.on('select', (p) => { if (!p) villar.highlight(null); });
let prog = '';
villar.on('progress', (p) => { prog = `фото ${p.samples}/${p.target}`; });
villar.on('photo', (p) => { if (p.state === 'stopped') prog = ''; });
setInterval(() => {
  const d = villar.debug;
  stat.textContent = `${d.quality} · dpr ${d.dpr.toFixed(2)} · ${d.fps ? d.fps.toFixed(0) + ' fps' : 'idle'} · calls ${d.info().calls} · tris ${(d.info().triangles / 1000).toFixed(0)}k ${prog ? '· ' + prog : ''}`;
  syncView(); syncTime();
}, 500);
