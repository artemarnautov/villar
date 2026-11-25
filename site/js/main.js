// Villar landing — boot sequence. Owner: interface.
// loadData → createStore → static sections → dynamic import of the 3D engine → bind events.
// The page keeps working (budget, swaps, plan view) if the engine is missing or throws.
import { loadData, formatAED } from './core/data.js';
import { createStore } from './core/store.js';
import { $ } from './ui/dom.js';
import { applyAccent } from './ui/accent.js';
import { setupReveal, setupNav, scrollToEl } from './ui/motion.js';
import { renderStudioCopy, renderStyle } from './ui/sections.js';
import { createHoverCard } from './ui/hovercard.js';
import { createSheet } from './ui/sheet.js';
import { createBudget } from './ui/budget.js';
import { createOrderModal } from './ui/order-modal.js';
import { createStage } from './ui/stage.js';

const warn = (...a) => console.warn('[villar]', ...a);

function pickQuality() {
  const q = new URLSearchParams(location.search).get('quality');
  if (q) return q;
  const small = window.matchMedia('(max-width: 734px) and (hover: none)').matches;
  const weak = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  return small || weak ? 'medium' : 'high';
}

/** "Студия 38 м² под ключ — от 29 914 AED": cheapest compatible option per placement. */
function renderHeroNote({ store, layout }) {
  const el = $('[data-hero-note]');
  if (!el) return;
  const min = store.placed().reduce((sum, p) => {
    const prices = store.options(p.slotType).map((o) => o.price).filter((n) => Number.isFinite(n));
    return sum + (prices.length ? Math.min(...prices) : p.item.price || 0);
  }, 0);
  if (!min) return;
  el.textContent = `${layout.name || 'Квартира'} под ключ — от ${formatAED(min)}. Мебель, свет, текстиль и декор.`;
  el.hidden = false;
}

async function boot() {
  clearTimeout(window.__villarBootGuard);
  requestAnimationFrame(() => document.documentElement.classList.add('is-loaded'));
  setupNav();
  setupReveal();

  const announcer = $('#announcer');
  const announce = (msg) => { announcer.textContent = ''; setTimeout(() => (announcer.textContent = msg), 30); };

  // Scroll CTAs
  const stageEl = $('#stage');
  document.querySelectorAll('[data-scroll-studio]').forEach((a) =>
    a.addEventListener('click', (e) => { e.preventDefault(); scrollToEl(stageEl); }));

  let data;
  try {
    data = await loadData();
  } catch (err) {
    warn('data failed to load', err);
    $('.stage-loading .loading-label').textContent = 'Не удалось загрузить данные. Обновите страницу.';
    $('.stage-loading .loading-bar').hidden = true;
    return;
  }
  const { layout, catalog, stylepack, palette } = data;
  const store = createStore({ catalog, stylepack, layout });
  const packName = stylepack.name || 'Тёмный орех';

  applyAccent(palette);
  renderHeroNote({ store, layout });
  renderStudioCopy({ root: $('#studio'), layout, stylepack });
  renderStyle({ root: $('#style'), stylepack, palette });

  const card = createHoverCard({ el: $('#hovercard'), store });
  const order = createOrderModal({ el: $('#order'), store, packName, layoutName: layout.name || 'Студия' });

  let sheet = null;
  const stage = createStage({
    root: stageEl, store, layout, stylepack, palette,
    onHover: (p) => (p ? card.show(p) : card.hide()),
    onSelect: (p) => {
      card.hide();
      if (p && p.slotType) sheet.open(p, { focus: !!p.keyboard });
      else sheet.close({ restoreFocus: false });
    },
  });

  sheet = createSheet({
    el: $('#sheet'), scrim: $('#sheet-scrim'), shell: $('.studio-shell'), stage: stageEl,
    store, packName,
    onOpen: (cur) => stage.highlight(cur.slotId),
    onClose: () => stage.highlight(null),
  });

  createBudget({
    el: $('#budget'), store, packName, announce,
    onOrder: () => order.open(),
    onLine: (type, from) => {
      const slot = store.placed().find((p) => p.slotType === type);
      if (!slot) return;
      scrollToEl(stageEl);
      setTimeout(() => sheet.open({ slotId: slot.slotId, slotType: type, item: slot.item }, { focus: true, from }), 280);
    },
  });

  document.querySelectorAll('[data-order]').forEach((b) => b.addEventListener('click', () => order.open()));

  // Late reveals for content rendered from data
  setupReveal();

  // Expose UI hooks for QA (no engine internals).
  window.villarUI = { store, stage, sheet, card, order };

  // 3D engine (built in parallel by the engine team): import lazily, degrade gracefully.
  try {
    const mod = await import('./engine/index.js');
    const createVillar = mod.createVillar || mod.default?.createVillar || mod.default;
    if (typeof createVillar !== 'function') throw new Error('engine/index.js does not export createVillar');
    await stage.mountEngine((opts) => createVillar(opts), { layout, catalog, stylepack, quality: pickQuality() });
  } catch (err) {
    stage.fail(err);
  }
}

boot().catch((err) => {
  warn('boot failed', err);
  document.documentElement.classList.add('is-loaded');
});

