// «Заказать комплект» — lead form (PT-18). Sends the contact plus the room snapshot to POST /api/lead; the server
// re-prices the room, so its total is the truth. No payment, no promises beyond "total as assembled". Owner: interface.
import { h, aed, quoted, NBSP } from './dom.js';
import { icon } from './icons.js';
import { t, onLang, itemsWord, getLang } from './i18n.js';
import { nameOf, packName } from './format.js';

const ENDPOINT = '/api/lead';
const TIMEOUT_MS = 12000;
const CONTACTS = [['whatsapp', 'lead.whatsapp'], ['phone', 'lead.call'], ['email', 'lead.byEmail']];

export function createOrderModal({ el, store, palettes, onOpen, onClose }) {
  el.classList.add('modal', 'modal-lead');
  el.setAttribute('aria-labelledby', 'order-title');
  el.setAttribute('aria-describedby', 'order-desc');

  let openedAt = 0, opener = null, closing = 0, sending = false, sent = null;
  let listOpen = false, contact = 'whatsapp';

  const coarse = matchMedia('(pointer: coarse)');

  // ---------- static skeleton ----------
  const closeBtn = h('button', { type: 'button', class: 'icon-btn modal-close', html: icon('close') });
  const eyebrow = h('p', { class: 't-eyebrow' });
  const title = h('h2', { id: 'order-title', tabindex: '-1' });
  const desc = h('p', { id: 'order-desc' });
  const head = h('div', { class: 'modal-head' }, eyebrow, title, desc, closeBtn);

  // Room summary
  const sumDots = h('span', { class: 'pdots', 'aria-hidden': 'true' });
  const sumStyle = h('span', { class: 'lead-sum-style' });
  const sumTotal = h('b', { class: 'num' });
  const sumNote = h('span', { class: 'lead-sum-note' });
  const listBtn = h('button', { type: 'button', class: 'lead-list-btn', 'aria-expanded': 'false', 'aria-controls': 'lead-lines' });
  const lines = h('ul', { class: 'modal-lines', id: 'lead-lines', role: 'list', hidden: true });
  const summary = h('section', { class: 'lead-sum' },
    h('div', { class: 'lead-sum-row' }, h('div', { class: 'lead-sum-l' }, h('div', { class: 'lead-sum-top' }, sumDots, sumStyle), sumNote), sumTotal),
    listBtn, lines);

  // Fields
  const field = (id, key, input, { optional = false } = {}) => {
    const lbl = h('span', { class: 'lead-lbl-text' });
    const opt = optional ? h('span', { class: 'lead-opt' }) : null;
    const err = h('span', { class: 'lead-err', id: `${id}-err`, 'aria-live': 'polite' });
    const wrap = h('div', { class: 'lead-field', 'data-field': id.replace('lead-', '') },
      h('label', { class: 'lead-lbl', for: id }, lbl, opt, err), input);
    input.id = id;
    input.setAttribute('aria-describedby', `${id}-err`);
    return { wrap, lbl, opt, err, input, key };
  };
  const nameIn = h('input', { class: 'lead-input', type: 'text', name: 'name', autocomplete: 'name', maxlength: '80', required: true, enterkeyhint: 'next' });
  const phoneIn = h('input', { class: 'lead-input', type: 'tel', name: 'phone', autocomplete: 'tel', inputmode: 'tel', maxlength: '30', required: true, enterkeyhint: 'next' });
  const emailIn = h('input', { class: 'lead-input', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', maxlength: '120', enterkeyhint: 'next' });
  const commentIn = h('textarea', { class: 'lead-input lead-textarea', name: 'comment', rows: '2', maxlength: '600' });
  const F = {
    name: field('lead-name', 'lead.name', nameIn),
    phone: field('lead-phone', 'lead.phone', phoneIn),
    email: field('lead-email', 'lead.email', emailIn, { optional: true }),
    comment: field('lead-comment', 'lead.comment', commentIn, { optional: true }),
  };

  // «Как удобнее связаться»: native radios styled as a segmented control (arrow keys for free)
  const contactLegendText = h('span', { class: 'lead-lbl-text' });
  const contactRadios = CONTACTS.map(([value, key]) => {
    const input = h('input', { type: 'radio', name: 'contact', value, class: 'lead-radio' });
    input.checked = value === contact;
    input.addEventListener('change', () => { if (input.checked) { contact = value; syncContact(); } });
    const span = h('span');
    return { input, key, span, label: h('label', { class: 'lead-seg-opt' }, input, span) };
  });
  const contactSet = h('fieldset', { class: 'lead-field lead-contact', 'data-field': 'contact' },
    h('legend', { class: 'lead-lbl' }, contactLegendText),
    h('div', { class: 'lead-seg' }, contactRadios.map((r) => r.label)));

  // Honeypot: off-screen, out of the tab order and the accessibility tree
  const honey = h('input', { type: 'text', name: 'company', tabindex: '-1', autocomplete: 'off' });
  const honeyWrap = h('div', { class: 'lead-hp', 'aria-hidden': 'true' }, honey);

  // Consent
  const consentIn = h('input', { type: 'checkbox', id: 'lead-consent', class: 'lead-check', 'aria-describedby': 'lead-consent-err' });
  const consentText = h('span', { class: 'lead-consent-text' });
  const consentErr = h('span', { class: 'lead-err', id: 'lead-consent-err', 'aria-live': 'polite' });
  const consent = h('div', { class: 'lead-consent', 'data-field': 'consent' },
    h('label', { class: 'lead-consent-lbl', for: 'lead-consent' }, consentIn, h('span', { class: 'lead-checkmark', 'aria-hidden': 'true', html: icon('check') }), consentText),
    consentErr);

  const formErr = h('p', { class: 'lead-form-err', role: 'alert' });
  const sendLbl = h('span');
  const sendBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg lead-send', form: 'lead-form' },
    h('span', { class: 'lead-spin', 'aria-hidden': 'true' }), sendLbl);

  const form = h('form', { class: 'lead-form', id: 'lead-form', novalidate: true },
    h('div', { class: 'lead-grid' }, F.name.wrap, F.phone.wrap, F.email.wrap, contactSet, F.comment.wrap),
    honeyWrap);
  const body = h('div', { class: 'modal-body' }, summary, form);
  // Consent + the send button stay in view at the bottom; errors there have reserved lines (no jump).
  const foot = h('div', { class: 'modal-foot lead-foot' }, h('div', { class: 'lead-foot-l' }, consent, formErr), sendBtn);

  // Success state
  const okTitle = h('h2', { id: 'lead-ok-title', tabindex: '-1' });
  const okText = h('p');
  const okRef = h('p', { class: 'lead-ok-ref num' });
  const okTotal = h('p', { class: 'lead-ok-ref num' });
  const okBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg' });
  const success = h('div', { class: 'lead-ok', hidden: true },
    h('div', { class: 'lead-ok-mark', 'aria-hidden': 'true', html: icon('check') }), okTitle, okText, okTotal, okRef, okBtn);

  const formView = h('div', { class: 'lead-view' }, head, body, foot);
  el.replaceChildren(h('div', { class: 'modal-inner' }, formView, success));

  // ---------- painting ----------
  function paintStatic() {
    eyebrow.textContent = t('order.eyebrow');
    title.textContent = t('order.title');
    desc.textContent = t('order.desc');
    closeBtn.setAttribute('aria-label', t('close'));
    for (const f of Object.values(F)) {
      f.lbl.textContent = t(f.key);
      if (f.opt) f.opt.textContent = t('lead.optional');
      if (f.err.dataset.key) f.err.textContent = t(f.err.dataset.key);
    }
    phoneIn.placeholder = t('lead.phoneHint');
    commentIn.placeholder = t('lead.commentHint');
    contactLegendText.textContent = t('lead.contact');
    contactRadios.forEach((r) => { r.span.textContent = t(r.key); });
    consentText.textContent = t('lead.consent');
    if (consentErr.dataset.key) consentErr.textContent = t(consentErr.dataset.key);
    if (formErr.dataset.key) formErr.textContent = t(formErr.dataset.key);
    sendLbl.textContent = sending ? t('lead.sending') : t('lead.send');
    okTitle.textContent = t('lead.okTitle');
    okText.textContent = t('lead.okText');
    okBtn.textContent = t('order.done');
    listBtn.textContent = t(listOpen ? 'order.hideList' : 'order.showList');
  }

  function paintRoom() {
    const pk = store.style();
    const sw = (palettes?.[pk?.id]?.swatches || []).slice().sort((a, b) => (b.share || 0) - (a.share || 0)).slice(0, 3);
    sumDots.replaceChildren(...sw.map((s) => h('i', { style: `--c:${s.hex}` })));
    const n = store.placed().length;
    sumStyle.textContent = t('order.summary', { style: quoted(packName(pk)), n, items: itemsWord(n) });
    sumNote.textContent = t('order.totalNote');
    sumTotal.textContent = aed(store.total());
    lines.replaceChildren(...store.lines().map(({ item, qty, sum }) =>
      h('li', null,
        h('span', null, nameOf(item), qty > 1 ? h('span', { class: 'q' }, ` ×${NBSP}${qty}`) : null),
        h('span', { class: 's' }, aed(sum)))));
  }

  // ---------- validation (mirrors /api/lead) ----------
  const consentF = { input: consentIn, err: consentErr, wrap: consent };
  const fieldOf = (k) => (k === 'consent' ? consentF : F[k]);
  function setErr(f, key) {
    f.err.dataset.key = key || '';
    f.err.textContent = key ? t(key) : '';
    if (key) f.input.setAttribute('aria-invalid', 'true'); else f.input.removeAttribute('aria-invalid');
    f.wrap.classList.toggle('is-invalid', !!key);
  }
  function checkField(k) {
    if (k === 'name') return nameIn.value.trim().replace(/\s+/g, ' ').length >= 2 ? null : 'lead.err.name';
    if (k === 'phone') {
      const raw = phoneIn.value.trim(); const d = raw.replace(/\D/g, '');
      return d.length >= 7 && d.length <= 15 && /^\+?[\d\s()-]+$/.test(raw) ? null : 'lead.err.phone';
    }
    if (k === 'email') {
      const v = emailIn.value.trim();
      if (!v) return contact === 'email' ? 'lead.err.emailNeeded' : null;
      return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v) ? null : 'lead.err.email';
    }
    if (k === 'consent') return consentIn.checked ? null : 'lead.err.consent';
    return null;
  }
  // Errors appear on submit (or on leaving a filled field) and then follow the user's edits.
  for (const k of ['name', 'phone', 'email']) {
    F[k].input.addEventListener('input', () => { if (F[k].err.dataset.key) setErr(F[k], checkField(k)); });
    F[k].input.addEventListener('blur', () => { if (F[k].input.value.trim()) setErr(F[k], checkField(k)); });
  }
  consentIn.addEventListener('change', () => { if (consentErr.dataset.key) setErr(consentF, checkField('consent')); });

  function syncContact() {
    contactRadios.forEach((r) => r.label.classList.toggle('is-on', r.input.checked));
    // E-mail becomes required when it is the preferred channel.
    emailIn.required = contact === 'email';
    if (F.email.opt) F.email.opt.hidden = contact === 'email';
    if (F.email.err.dataset.key === 'lead.err.emailNeeded' && contact !== 'email') setErr(F.email, null);
  }

  listBtn.addEventListener('click', () => {
    listOpen = !listOpen;
    lines.hidden = !listOpen;
    listBtn.setAttribute('aria-expanded', String(listOpen));
    listBtn.textContent = t(listOpen ? 'order.hideList' : 'order.showList');
  });

  function setFormErr(key) { formErr.dataset.key = key || ''; formErr.textContent = key ? t(key) : ''; }

  function setSending(on) {
    sending = on;
    sendBtn.disabled = on;
    sendBtn.classList.toggle('is-sending', on);
    sendBtn.setAttribute('aria-busy', on ? 'true' : 'false');
    sendLbl.textContent = on ? t('lead.sending') : t('lead.send');
    form.inert = on;
  }

  async function submit(e) {
    e?.preventDefault();
    if (sending) return;
    setFormErr(null);
    let first = null;
    for (const k of ['name', 'phone', 'email', 'consent']) {
      const err = checkField(k);
      setErr(fieldOf(k), err);
      if (err && !first) first = fieldOf(k).input;
    }
    if (first) { first.focus(); return; }

    const snap = store.snapshot();
    const payload = {
      name: nameIn.value.trim(), phone: phoneIn.value.trim(), email: emailIn.value.trim() || undefined,
      comment: commentIn.value.trim() || undefined, contact, consent: true, lang: getLang(),
      style: snap.style, selection: snap.selection, openedMs: Math.round(performance.now() - openedAt), company: honey.value,
    };
    setSending(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res = null, json = null;
    try {
      res = await fetch(ENDPOINT, { method: 'POST', credentials: 'same-origin', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      json = await res.json().catch(() => null);
    } catch { /* network / timeout → calm fallback below */ }
    clearTimeout(timer);
    setSending(false);

    if (res?.ok && json?.ok) return showSuccess(json);
    if (res?.status === 400 && json?.error === 'invalid') {
      const f = json.field;
      if (f === 'room') { setFormErr('lead.err.room'); return; }
      const map = { name: 'lead.err.name', phone: 'lead.err.phone', email: 'lead.err.email', consent: 'lead.err.consent' };
      if (map[f]) { setErr(fieldOf(f), map[f]); fieldOf(f).input.focus(); return; }
    }
    setFormErr(res?.status === 429 ? 'lead.err.rate' : 'lead.err.fail'); // the form stays filled
    sendBtn.focus({ preventScroll: true });
  }
  form.addEventListener('submit', submit);

  function showSuccess(json) {
    sent = json;
    const id = typeof json.id === 'string' && json.id ? json.id.slice(0, 8).toUpperCase() : '';
    okRef.textContent = id ? t('lead.okRef', { id }) : '';
    okRef.hidden = !id;
    const total = Number(json.total) > 0 ? Number(json.total) : store.total();
    okTotal.textContent = t('lead.okTotal', { total: aed(total) });
    formView.hidden = true;
    success.hidden = false;
    okTitle.focus({ preventScroll: true });
  }

  function resetForm() {
    sent = null;
    for (const f of Object.values(F)) { f.input.value = ''; setErr(f, null); }
    consentIn.checked = false; setErr(consentF, null); setFormErr(null);
    formView.hidden = false; success.hidden = true;
  }

  // ---------- open / close ----------
  function open() {
    clearTimeout(closing);
    if (sent) resetForm();
    if (!el.open) opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    paintStatic(); paintRoom(); syncContact();
    if (typeof el.showModal === 'function') { if (!el.open) el.showModal(); } else el.setAttribute('open', '');
    openedAt = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-open')));
    // Touch: don't pop the keyboard over the summary; start at the title (Tab/swipe reaches the name next)
    if (coarse.matches) title.focus({ preventScroll: true });
    else nameIn.focus({ preventScroll: true });
    onOpen?.();
  }

  function close() {
    if (!el.open) return;
    el.classList.remove('is-open');
    clearTimeout(closing);
    closing = setTimeout(() => {
      if (typeof el.close === 'function') el.close(); else el.removeAttribute('open');
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      opener = null;
    }, 280);
    onClose?.();
  }

  el.addEventListener('cancel', (e) => { e.preventDefault(); close(); }); // Esc
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  closeBtn.addEventListener('click', close);
  okBtn.addEventListener('click', close);
  store.on('change', () => { if (el.open && !sent) paintRoom(); });
  onLang(() => { if (el.open) { paintStatic(); paintRoom(); } });

  return { open, close };
}
