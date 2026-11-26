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
  if (lang !== 'en') return;
  document.title = 'Villar — a home ready to live in. In one day.';
  var swap = function (sel, fn) { var n = document.querySelectorAll(sel); for (var j = 0; j < n.length; j++) fn(n[j]); };
  swap('[data-en]', function (el) { el.textContent = el.getAttribute('data-en'); });
  swap('[data-en-aria-label]', function (el) { el.setAttribute('aria-label', el.getAttribute('data-en-aria-label')); });
  swap('[data-en-alt]', function (el) { el.setAttribute('alt', el.getAttribute('data-en-alt')); });
}());
