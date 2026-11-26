// Style pack chips above the stage: each chip previews its palette (three dots) and switches the room.
// Owner: interface. Follows the interface language (D2-02). A click paints the pressed state at once and hands
// the actual switch to `onPick` (which defers the heavy work by a frame — D2-08).
import { h } from './dom.js';
import { t, onLang } from './i18n.js';
import { tierOf } from './labels.js';
import { packName } from './format.js';

/** Three representative colours of a palette: base, secondary, accent (largest share in each tier). */
function paletteDots(palette) {
  const sw = (palette?.swatches || []).filter((s) => s && s.hex).sort((a, b) => (b.share || 0) - (a.share || 0));
  const pick = ['base', 'secondary', 'accent'].map((tier) => sw.find((s) => tierOf(s.role) === tier)).filter(Boolean);
  return (pick.length ? pick : sw.slice(0, 3)).map((s) => s.hex);
}

export function createStylePicker({ el, store, palettes, onPick }) {
  el.classList.add('style-picker');
  el.setAttribute('role', 'group');
  let chips = new Map();

  function render() {
    const packs = store.styles();
    const active = store.styleId();
    const focusedId = el.contains(document.activeElement) ? document.activeElement.dataset.style : null;
    el.setAttribute('aria-label', t('picker.aria'));
    chips = new Map();
    const list = packs.map((p) => {
      const on = p.id === active;
      const b = h('button', { type: 'button', class: `style-chip${on ? ' is-active' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'data-style': p.id },
        h('span', { class: 'pdots', 'aria-hidden': 'true' }, paletteDots(palettes?.[p.id]).map((c) => h('i', { style: `--c:${c}` }))),
        h('span', null, packName(p)));
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-pressed') === 'true') return;
        setPending(p.id);
        if (onPick) onPick(p.id); else store.setStyle(p.id);
      });
      chips.set(p.id, b);
      return b;
    });
    el.replaceChildren(...[
      h('span', { class: 'style-picker-label' }, t('picker.label')),
      h('div', { class: 'style-chips' }, list),
      packs.length < 2 ? h('span', { class: 'style-picker-soon' }, t('picker.soon')) : null,
    ].filter(Boolean));
    if (focusedId) chips.get(focusedId)?.focus({ preventScroll: true });
  }

  /** Paint the chosen chip as pressed right away (the switch itself lands a frame later). */
  function setPending(id) {
    for (const [cid, b] of chips) {
      const on = cid === id;
      b.classList.toggle('is-active', on);
      b.classList.toggle('is-pending', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  render();
  store.on('style', render);
  onLang(render);
  return { render, setPending };
}
