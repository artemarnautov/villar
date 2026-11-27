// Villar boot (classic, synchronous, last in <body>): picks the interface language before the first paint, so an
// English visitor never sees the Russian HTML flash. Same rule as js/ui/i18n.js detect(): ?lang= → saved choice →
// browser languages (any Russian → ru, else en). English static text comes from data-en* attributes.
// External file on purpose: the CSP allows 'self' scripts, no inline hash needed. Owner: interface.
(function () {
  var lang = null;
  try {
    lang = new URLSearchParams(location.search).get('lang');
    if (lang !== 'ru' && lang !== 'en') lang = localStorage.getItem('villar:lang');
  } catch (e) { /* storage blocked */ }
  if (lang !== 'ru' && lang !== 'en') {
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'ru'];
    lang = 'en';
    for (var i = 0; i < list.length; i++) if (/^ru(\b|-)/i.test(list[i])) { lang = 'ru'; break; }
  }
  document.documentElement.lang = lang;

  // Known issue 5: the loading poster shows the style the visitor last left, framed like the live view.
  try {
    var img = document.querySelector('.stage-poster[data-poster-key]');
    // Store keys, newest first (v3, then the v2 fallback); `style` is top-level in both.
    var keys = img ? img.getAttribute('data-poster-key').split(/\s+/) : [];
    var style = '';
    for (var k = 0; k < keys.length && !style; k++) {
      var saved = keys[k] ? JSON.parse(localStorage.getItem(keys[k]) || 'null') : null;
      if (saved && typeof saved.style === 'string') style = saved.style;
    }
    if (/^[a-z][a-z-]{1,40}$/.test(style) && style !== img.getAttribute('data-poster-default')) {
      var fallback = img.getAttribute('src');
      img.onerror = function () { img.onerror = null; img.src = fallback; };
      img.src = img.getAttribute('data-poster-base') + style + '.jpg';
    }
  } catch (e) { /* storage blocked or bad JSON: keep the default poster */ }

  if (lang !== 'en') return;
  document.title = 'Villar — a home ready to live in. In one day.';
  var swap = function (sel, fn) { var n = document.querySelectorAll(sel); for (var j = 0; j < n.length; j++) fn(n[j]); };
  swap('[data-en]', function (el) { el.textContent = el.getAttribute('data-en'); });
  swap('[data-en-aria-label]', function (el) { el.setAttribute('aria-label', el.getAttribute('data-en-aria-label')); });
  swap('[data-en-alt]', function (el) { el.setAttribute('alt', el.getAttribute('data-en-alt')); });
}());
