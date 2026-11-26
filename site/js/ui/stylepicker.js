// Style pack chips above the stage: each chip previews its palette (three dots) and switches the room.
// Owner: interface.
import { h } from './dom.js';
import { t } from './i18n.js';
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

  function render() {
    const packs = store.styles();
    const active = store.styleId();
    el.setAttribute('aria-label', t('picker.aria'));
    const chips = packs.map((p) => {
      const on = p.id === active;
      const b = h('button', { type: 'button', class: `style-chip${on ? ' is-active' : ''}`, 'aria-pressed': on ? 'true' : 'false' },
        h('span', { class: 'pdots', 'aria-hidden': 'true' }, paletteDots(palettes?.[p.id]).map((c) => h('i', { style: `--c:${c}` }))),
        h('span', null, packName(p)));
      if (!on) b.addEventListener('click', () => { onPick?.(p.id); store.setStyle(p.id); });
      return b;
    });
    el.replaceChildren(...[
      h('span', { class: 'style-picker-label' }, t('picker.label')),
      h('div', { class: 'style-chips' }, chips),
      packs.length < 2 ? h('span', { class: 'style-picker-soon' }, t('picker.soon')) : null,
    ].filter(Boolean));
  }

  render();
  store.on('style', render);
  return { render };
}
