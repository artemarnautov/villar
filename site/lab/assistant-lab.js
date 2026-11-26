// Assistant lab: the real store + data, a stub engine, optional mocked API. Owner: assistant.
//   /lab/assistant.html                 → real /api/assistant (falls back to the local parser if absent)
//   ?mock=1                             → canned AI responses (no network)
//   ?lang=en, ?ask=<text>, ?freeze=thinking
import { loadData } from '/js/core/data.js';
import { createStore } from '/js/core/store.js';
import { mountAssistant } from '/js/ai/assistant.js';

const q = new URLSearchParams(location.search);
const data = await loadData();
const store = createStore({ catalog: data.catalog, layout: data.layout, packs: data.packs, styleId: data.styleId, persist: false });
const logEl = document.getElementById('log');
const note = (t) => { const s = document.createElement('span'); s.textContent = t; logEl.append(s); while (logEl.children.length > 5) logEl.firstChild.remove(); };
const totalEl = document.getElementById('total');
const nf = new Intl.NumberFormat('ru-RU');
const paintTotal = () => { totalEl.textContent = `${nf.format(store.total())} AED`; };
store.on('change', paintTotal); paintTotal();

// Stub engine: records calls, emits time events like the real one.
const listeners = {};
const villar = {
  view: 'eye', timeOfDay: 'day',
  on(e, f) { (listeners[e] ||= []).push(f); },
  setView(v) { this.view = v; note(`setView(${v})`); (listeners.view || []).forEach((f) => f({ view: v })); },
  setTimeOfDay(t) { this.timeOfDay = t; note(`setTimeOfDay(${t})`); (listeners.time || []).forEach((f) => f({ time: t })); },
  focus(slotId) { note(`focus(${slotId})`); },
  highlight(slotId) { if (slotId) note(`highlight(${slotId})`); },
};
store.on('change', (e) => note(`select ${e.key} → ${e.itemId}`));
window.__lab = { store, villar };

if (q.has('mock') || q.has('freeze')) {
  const real = window.fetch;
  window.fetch = async (url, init) => {
    if (!String(url).includes('/api/assistant')) return real(url, init);
    const body = JSON.parse(init.body);
    const text = body.messages.at(-1).content.toLowerCase();
    if (q.get('freeze') === 'thinking') return new Promise(() => {});
    await new Promise((r) => setTimeout(r, 900));
    let res;
    if (/уют|cos/.test(text)) res = { reply: 'Добавил тёплый вечерний свет и подушки в терракоте — так студия собирается вокруг дивана.', actions: [{ type: 'time', name: 'evening' }, { type: 'select', key: 'cushions', itemId: 'cushions-linen-clay' }], chips: ['Ковёр мягче', 'Покажи спальню', 'Верни день'] };
    else if (/свет|light/.test(text)) res = { reply: 'Hadley в молочном — светлее и легче, силуэт тот же. Цена не меняется.', actions: [{ type: 'select', key: 'sofa', itemId: 'sofa-hadley-3' }, { type: 'view', name: 'living' }], chips: ['Кресло в ткани', 'Покажи вечер', 'Уложись в 28 000'] };
    else res = { reply: 'Готово.', actions: [], chips: [] };
    return new Response(JSON.stringify(res), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

// Mounted exactly like site/js/main.js: `villar` is a getter and the engine arrives after the bar.
let engineRef = null;
const lang = q.get('lang') || 'ru';
const ai = mountAssistant({
  container: document.getElementById('assistant'), store, lang,
  get villar() { return engineRef; },
  getView: () => ({ view: engineRef?.view || 'eye', time: engineRef?.timeOfDay || 'day', lang }),
});
setTimeout(() => { engineRef = villar; }, 300);
window.__lab.ai = ai;
await new Promise((r) => setTimeout(r, 400));
for (const t of q.getAll('ask')) await ai.ask(t);
window.__labReady = true;
