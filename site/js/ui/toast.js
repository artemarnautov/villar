// Quiet toast at the top of the stage: «Стиль «Светлый дуб» · Вернуть». Owner: interface.
import { h } from './dom.js';

export function createToast({ host }) {
  const text = h('span', { class: 'toast-text' });
  const action = h('button', { type: 'button', class: 'toast-action' });
  const el = h('div', { class: 'toast glass', role: 'status', 'aria-live': 'polite', hidden: true }, text, action);
  host.append(el);
  let timer = 0, onAction = null, hideTimer = 0;

  action.addEventListener('click', () => { const fn = onAction; hide(); fn?.(); });

  function show(msg, { actionLabel = '', onAction: fn = null, ms = 7000 } = {}) {
    clearTimeout(timer); clearTimeout(hideTimer);
    text.textContent = msg;
    action.textContent = actionLabel;
    action.hidden = !actionLabel;
    onAction = fn;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-visible'));
    timer = setTimeout(hide, ms);
  }
  function hide() {
    clearTimeout(timer);
    onAction = null;
    if (el.hidden) return;
    // Don't strand keyboard focus on a button that is about to disappear.
    if (el.contains(document.activeElement)) document.activeElement.blur();
    el.classList.remove('is-visible');
    hideTimer = setTimeout(() => { el.hidden = true; }, 320);
  }
  return { show, hide, el };
}
