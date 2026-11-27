// Villar landing — boot sequence. Owner: interface.
// loadData → multi-style store → static sections → (stage near viewport) import the 3D engine → bind events.
// The page keeps working (budget, swaps, styles, 2D plan) if the engine is missing, throws, stalls or loses WebGL.
import { loadData } from './core/data.js';
import { createStore } from './core/store.js';
import { $, isCompact, quoted, aed } from './ui/dom.js';
import { t, getLang, setLang, onLang, applyStatic } from './ui/i18n.js';
import { applyAccent } from './ui/accent.js';
import { setupReveal, setupNav, scrollToEl } from './ui/motion.js';
import { renderStyle, renderHeroNote } from './ui/sections.js';
import { createHoverCard } from './ui/hovercard.js';
import { createHud } from './ui/hud.js';
import { createBudget } from './ui/budget.js';
import { createBudgetController } from './ui/budget-slider.js';
import { createOrderModal } from './ui/order-modal.js';
import { createStage } from './ui/stage.js';
import { createStylePicker } from './ui/stylepicker.js';
import { createToast } from './ui/toast.js';
import { packName } from './ui/format.js';

const warn = (...a) => console.warn('[villar]', ...a);
const mq = (q) => window.matchMedia(q).matches;

// The assistant agent ships `mountAssistant` from site/js/ai/ (see docs/requests/assistant.md).
// Set to its module path once it exists; until then the slot under the stage stays empty and collapsed.
const ASSISTANT_MODULE = './ai/assistant.js';

/** Render tier: phones 'low', tablets / iOS / touch-first / weak machines 'medium', else 'high'. */
function pickQuality() {
  const q = new URLSearchParams(location.search).get('quality');
  if (q) return q;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
  const coarse = mq('(pointer: coarse)');
  if ((ios || coarse) && mq('(max-width: 734px)')) return 'low';
  const weak = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  return ios || coarse || weak ? 'medium' : 'high';
}

function setupLangToggle() {
  const btn = $('#lang-toggle');
  if (!btn) return;
  const sync = () => { btn.textContent = t('lang.toggle'); btn.setAttribute('aria-label', t('lang.aria')); btn.setAttribute('lang', getLang() === 'ru' ? 'en' : 'ru'); };
  sync();
  btn.addEventListener('click', () => setLang(getLang() === 'ru' ? 'en' : 'ru'));
  onLang(sync);
}

async function boot() {
  applyStatic();
  setupNav();
  setupReveal();
  setupLangToggle();

  const announcer = $('#announcer');
  const announce = (msg) => { announcer.textContent = ''; setTimeout(() => (announcer.textContent = msg), 30); };
  const stageEl = $('#stage');
  let startEngine = () => {};

  // CTAs that lead to the 3D view: scroll the stage under the nav, and make sure the engine is coming.
  document.querySelectorAll('[data-scroll-studio]').forEach((a) =>
    a.addEventListener('click', (e) => { e.preventDefault(); startEngine(); scrollToEl($('.style-picker-wrap') || stageEl, { pad: 8 }); }));

  let data;
  try {
    data = await loadData();
  } catch (err) {
    warn('data failed to load', err);
    $('.stage-loading .loading-label').textContent = getLang() === 'en' ? 'Could not load the data. Please reload the page.' : 'Не удалось загрузить данные. Обновите страницу.';
    $('.stage-loading .loading-bar').hidden = true;
    return;
  }
  const { layout, catalog, packs, palettes = {}, styleId } = data;
  const store = createStore({ catalog, layout, packs, styleId });
  const activePalette = () => palettes[store.styleId()] || null;

  applyAccent(activePalette());
  const paintHeroNote = renderHeroNote({ el: $('[data-hero-note]'), store });
  const paintStyle = () => renderStyle({ root: $('#style'), stylepack: store.style(), palette: activePalette() });
  paintStyle();

  const card = createHoverCard({
    el: $('#hovercard'), store, bounds: () => stageEl,
    avoid: () => [...stageEl.querySelectorAll('.stage-dock .seg, .stage-top-l, .stage-top-r, .stage-back, .toast:not([hidden]), .busy-chip:not([hidden])')],
  });

  // D2-19: on phones the system Back gesture closes the top layer (modal, then item panel) instead of the page.
  const layers = { hud: false, modal: false };
  let ignorePops = 0;
  const pushLayer = (kind) => {
    if (!isCompact() || layers[kind]) return;
    try { history.pushState({ villar: kind }, ''); layers[kind] = true; } catch { /* ignore */ }
  };
  const popLayer = (kind) => {
    if (!layers[kind]) return;
    layers[kind] = false; ignorePops++;
    history.back();
  };
  window.addEventListener('popstate', () => {
    if (ignorePops) { ignorePops--; return; }
    if (layers.modal) { layers.modal = false; order.close(); } else if (layers.hud) { layers.hud = false; hud.close(); }
  });

  const order = createOrderModal({
    el: $('#order'), store, palettes,
    onOpen: () => pushLayer('modal'),
    onClose: () => popLayer('modal'),
  });

  let hud = null;
  let budget = null;
  const stage = createStage({
    root: stageEl, store, layout, palettes,
    // The HUD already shows everything the card would: no card while it is open.
    onHover: (p) => (p && !hud?.isOpen ? card.show(p) : card.hide()),
    onSelect: (p) => {
      card.hide();
      if (p && (p.slotId || p.slotType)) hud.open(p, { focus: !!p.keyboard });
      else hud.close({ restoreFocus: false });
    },
    onModeChange: (m) => { if ((m === '3d' || m === 'plan') && hud?.isOpen) hud.refresh(); },
    onBack: () => hud.close(),
  });

  // Focus card (docs/FOCUS.md): engine-side pieces (turntable, 'inspect', focusNext, project) are feature-detected.
  hud = createHud({
    el: $('#hud'), shell: $('.studio-shell'), stage: stageEl, scene: stage,
    store, palettes, thumbs: stage.thumbs, spec: data.budget || null, announce, editions: data.editions !== false,
    level: () => { try { return slider?.position()?.level?.id || null; } catch { return null; } },
    // «Подстроить комнату под этот стиль»: the card offers its own Undo, so no stage toast.
    onStyleSwitch: (id, opts) => switchStyle(id, opts),
    onOpen: (cur, { same, wasOpen, engineFlies }) => {
      card.hide();
      budget?.setSheetOpen(true);
      pushLayer('hud');
      // Phones: bring the whole stage under the nav so the object stays visible above the sheet.
      if (!wasOpen && isCompact()) scrollToEl(stageEl, { pad: 8 });
      // Fly to the object once the card has its size (it frames the object in the uncovered part). Walking or
      // tapping another item while focused glides straight there (the engine retargets from where it is).
      if (!same) requestAnimationFrame(() => requestAnimationFrame(() => {
        if (hud.current?.slotId !== cur.slotId) return;
        if (engineFlies) stage.setInsets(hud.insets()); else stage.focus(cur.slotId, hud.insets());
      }));
    },
    onResize: (insets) => { if (hud.isOpen) stage.setInsets(insets); },
    onClose: () => { stage.unfocus(); budget?.setSheetOpen(false); popLayer('hud'); card.quiet(600); },
  });

  // Budget slider (docs/BUDGET.md): one controller over the style's ladder; the bar and the phone dock render it.
  let slider = null;
  try { slider = createBudgetController({ store, spec: data.budget }); } catch (err) { warn('budget slider unavailable', err); }
  budget = createBudget({
    el: $('#budget'), store, stage: stageEl, announce, slider,
    onOrder: () => order.open(),
    onLine: (slotId, from) => {
      const slot = store.placed().find((p) => p.slotId === slotId);
      if (!slot) return;
      startEngine();
      scrollToEl($('.style-picker-wrap') || stageEl, { pad: 8 });
      setTimeout(() => hud.open({ slotId: slot.slotId, slotType: slot.slotType, item: slot.item }, { focus: true, from }), 320);
    },
  });

  // D2-08 + PT-01: a manual style switch answers at once (pressed chip + «Меняем стиль…»), does the heavy work a
  // frame later, and offers a quiet «Вернуть» that restores the exact previous state (style and every pick).
  const toast = createToast({ host: stageEl.querySelector('.stage-ui') });
  let switching = false;
  function switchStyle(id, { anchor, quiet = false } = {}) {
    if (switching || !store.style(id) || id === store.styleId()) return;
    switching = true;
    const prev = store.snapshot();
    const prevName = packName(store.style(prev.style));
    picker.setPending(id);
    toast.hide();
    const hideBusy = stage.mode === '3d' ? stage.busy(t('switching')) : () => {};
    const t0 = performance.now();
    requestAnimationFrame(() => setTimeout(() => {
      // PT4-02: a room set by the budget slider keeps its budget in the new style (one transition); from the
      // designer room (or with an anchor from the item panel) the switch lands on the style's own room as before.
      let kept = null;
      try { kept = anchor ? null : slider?.planForStyle(id) || null; } catch (err) { warn('budget-preserving switch failed', err); }
      try { store.setStyle(id, kept ? { selection: kept.selection } : anchor ? { anchor } : {}); } finally { switching = false; }
      const done = () => {
        hideBusy();
        if (quiet) return; // the focus card offers its own «Вернуть»
        const msg = kept
          ? t('toast.styleBudget', { style: packName(store.style(id)), level: kept.label, total: aed(store.total()) })
          : t('toast.style', { style: quoted(packName(store.style(id))) });
        toast.show(msg, {
          actionLabel: t('toast.undo'),
          onAction: () => {
            store.restore(prev);
            toast.show(t('toast.undone', { style: quoted(prevName) }), { ms: 2400 });
          },
        });
      };
      const wait = Math.max(0, 450 - (performance.now() - t0));
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, wait)));
    }, 0));
  }
  const picker = createStylePicker({ el: $('#style-picker'), store, palettes, onPick: (id) => switchStyle(id) });

  // Grabbing the budget: the whole room comes back into view (no focused item), the engine keeps the camera
  // still and defers its heavy work. Letting go leaves one quiet «Вернуть» beside the slider itself (D4-05).
  slider?.on('grab', () => {
    if (hud.isOpen) hud.close({ restoreFocus: false });
    card.hide();
    toast.hide();
    stage.setDragging(true);
  });
  slider?.on('release', () => stage.setDragging(false));
  // Any other change after a switch retires the undo offer (it would no longer restore just the style).
  store.on('change', ({ reason }) => { if (reason !== 'style' && reason !== 'restore') toast.hide(); });

  // Style switch: accent, palette section, chip; the engine stages its own transition from the same event.
  store.on('style', ({ styleId: id }) => {
    if (!switching) toast.hide();   // a switch made elsewhere (the AI, Undo) retires the chip's Undo offer
    applyAccent(palettes[id] || null);
    paintStyle();
    stage.syncStyle();
    announce(`${t('style')}: ${quoted(packName(store.style(id)))}`);
  });

  onLang(() => { paintStyle(); paintHeroNote?.(); toast.hide(); });

  document.querySelectorAll('[data-order]').forEach((b) => b.addEventListener('click', () => order.open()));
  setupReveal();

  // Expose UI hooks for QA (no engine internals).
  window.villarUI = { store, stage, hud, card, order, setLang, switchStyle, toast, slider };

  // ── Live → Photo (owner: photo · docs/PHOTOREAL.md «Live → Photo»). Optional: without it the page is unchanged. ──
  import('./photo/index.js').then((m) => m.mountPhoto({ root: stageEl, store, stage })).catch((err) => warn('photo unavailable', err?.message || err));
  // ── end Live → Photo ──

  // AI assistant under the stage (owned by the assistant agent; mounted only when its module exists).
  async function mountAssistant() {
    const slot = $('#assistant');
    if (!ASSISTANT_MODULE || !slot) return;
    try {
      const mod = await import(ASSISTANT_MODULE);
      if (typeof mod.mountAssistant !== 'function') return;
      slot.hidden = false;
      document.documentElement.classList.add('has-assistant');
      await mod.mountAssistant({
        container: slot, store, lang: getLang(),
        // The AI's «уложись в N» moves this same slider (same ladder, same pins).
        budget: slider, budgetSpec: data.budget || null,
        get villar() { return stage.engine; },
        getView: () => ({ view: stage.view, time: stage.time, focus: hud.current?.slotId || null, lang: getLang() }),
        // Keep the dock / time controls and the HUD in sync with what the assistant does.
        controls: { view: (v) => stage.setView(v), time: (x) => stage.setTime(x) },
        onFocus: (slotId) => {
          const p = store.placed().find((x) => x.slotId === slotId);
          if (p) hud.open(p, { focus: false });
        },
      });
    } catch (err) {
      slot.hidden = true;
      document.documentElement.classList.remove('has-assistant');
      warn('assistant unavailable', err?.message || err);
    }
  }
  mountAssistant();

  // 3D engine: import when the stage approaches the viewport (or on a CTA), then degrade gracefully.
  let started = false;
  startEngine = async () => {
    if (started) return;
    started = true;
    try {
      const mod = await import('./engine/index.js');
      const createVillar = mod.createVillar || mod.default?.createVillar || mod.default;
      if (typeof createVillar !== 'function') throw new Error('engine/index.js does not export createVillar');
      await stage.mountEngine((opts) => createVillar(opts), { layout, catalog, stylepack: store.style(), palette: activePalette(), quality: pickQuality() });
    } catch (err) {
      stage.fail(err);
    }
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); startEngine(); } }, { rootMargin: '100% 0px' });
    io.observe(stageEl);
  } else startEngine();
}

boot().catch((err) => warn('boot failed', err));
