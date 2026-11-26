// Accessible segmented control (radiogroup with a sliding thumb). Owner: interface.
import { h, svg } from './dom.js';
import { icon } from './icons.js';

export function createSegmented({ label, items, value, onChange, className = '' }) {
  const root = h('div', { class: `seg glass ${className}`, role: 'radiogroup', 'aria-label': label });
  const thumb = h('span', { class: 'seg-thumb', 'aria-hidden': 'true' });
  root.append(thumb);

  let current = value ?? items[0]?.value;
  const buttons = items.map((it) => {
    const b = h('button', {
      type: 'button', class: 'seg-btn', role: 'radio',
      'aria-checked': 'false', tabindex: '-1', 'data-value': it.value,
    });
    if (it.icon) b.append(svg(icon(it.icon)));
    b.append(h('span', null, it.label));
    b.addEventListener('click', () => set(it.value, true));
    root.append(b);
    return b;
  });

  root.addEventListener('keydown', (e) => {
    const i = Math.max(0, buttons.findIndex((b) => b.dataset.value === current));
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % buttons.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = buttons.length - 1;
    if (n < 0) return;
    e.preventDefault();
    e.stopPropagation();
    set(buttons[n].dataset.value, true);
    buttons[n].focus();
  });

  function place() {
    const b = buttons.find((x) => x.dataset.value === current);
    if (!b || !b.offsetWidth) return;
    thumb.style.width = `${b.offsetWidth}px`;
    thumb.style.transform = `translateX(${b.offsetLeft}px)`;
    if (!root.classList.contains('is-ready')) requestAnimationFrame(() => root.classList.add('is-ready'));
  }

  function set(v, user = false) {
    if (v == null) {
      // No option applies (e.g. the camera was moved freely): nothing checked, thumb hidden.
      current = null;
      buttons.forEach((b, i) => { b.setAttribute('aria-checked', 'false'); b.tabIndex = i === 0 ? 0 : -1; });
      root.classList.add('is-none');
      return;
    }
    if (!buttons.some((b) => b.dataset.value === v)) return;
    root.classList.remove('is-none');
    const changed = v !== current;
    current = v;
    for (const b of buttons) {
      const on = b.dataset.value === v;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
    place();
    const active = buttons.find((b) => b.dataset.value === v);
    if (active && root.scrollWidth > root.clientWidth) {
      const l = active.offsetLeft - (root.clientWidth - active.offsetWidth) / 2;
      root.scrollTo({ left: l, behavior: 'smooth' });
    }
    if (user && changed && onChange) onChange(v);
  }

  set(current);
  if ('ResizeObserver' in window) new ResizeObserver(place).observe(root);
  document.fonts?.ready?.then(place);

  return {
    el: root,
    get value() { return current; },
    set: (v) => set(v, false),
    /** New labels (language switch) without rebuilding. */
    relabel(next, label) {
      if (label) root.setAttribute('aria-label', label);
      for (const it of next) {
        const b = buttons.find((x) => x.dataset.value === it.value);
        const span = b?.querySelector('span');
        if (span) span.textContent = it.label;
      }
      requestAnimationFrame(place);
    },
    disable(off) { root.setAttribute('aria-disabled', off ? 'true' : 'false'); buttons.forEach((b) => (b.disabled = !!off)); },
  };
}
