// Assistant vocabulary, RU + EN. Owner: assistant. Pure (no DOM) so the server can reuse it.

export const NBSP = ' ';

const TYPES = {
  ru: {
    sofa: 'Диван', armchair: 'Кресло', coffee_table: 'Журнальный столик', side_table: 'Приставной столик',
    tv_unit: 'ТВ-тумба', bed: 'Кровать', mattress: 'Матрас', bedding: 'Постельное бельё',
    nightstand: 'Прикроватные тумбы', dining_table: 'Обеденный стол', dining_chair: 'Стулья',
    floor_lamp: 'Торшер', table_lamp: 'Настольные лампы', pendant_lamp: 'Подвесной светильник', rug: 'Ковёр',
    curtains: 'Шторы', wall_art: 'Картина', plant: 'Растение', decor_set: 'Декор', cushions: 'Подушки',
    throw: 'Плед', mirror: 'Зеркало', tableware: 'Сервировка', centerpiece: 'Центр стола',
    kitchen_decor: 'Кухонный декор', runner: 'Дорожка', towels: 'Полотенца', nightstand_decor: 'Декор у кровати',
  },
  en: {
    sofa: 'Sofa', armchair: 'Armchair', coffee_table: 'Coffee table', side_table: 'Side table',
    tv_unit: 'TV unit', bed: 'Bed', mattress: 'Mattress', bedding: 'Bedding', nightstand: 'Nightstands',
    dining_table: 'Dining table', dining_chair: 'Chairs', floor_lamp: 'Floor lamp', table_lamp: 'Table lamps',
    pendant_lamp: 'Pendant', rug: 'Rug', curtains: 'Curtains', wall_art: 'Art', plant: 'Plant',
    decor_set: 'Decor', cushions: 'Cushions', throw: 'Throw', mirror: 'Mirror', tableware: 'Tableware',
    centerpiece: 'Centerpiece', kitchen_decor: 'Kitchen decor', runner: 'Runner', towels: 'Towels',
    nightstand_decor: 'Bedside decor',
  },
};
// Per-key overrides (wall art keys are per placement).
const KEYS = {
  ru: { art_sofa: 'Картина над диваном', art_bed: 'Картина над кроватью', art_dining: 'Картина в столовой', decor_coffee: 'Декор на столике', decor_tv: 'Декор на ТВ-тумбе' },
  en: { art_sofa: 'Art above the sofa', art_bed: 'Art above the bed', art_dining: 'Dining art', decor_coffee: 'Coffee-table decor', decor_tv: 'TV-unit decor' },
};

export const VIEW_LABELS = {
  ru: { eye: 'Вход', living: 'Гостиная', bed: 'Спальня', dining: 'Столовая', window: 'У окна', top: 'План' },
  en: { eye: 'Entry', living: 'Living', bed: 'Bedroom', dining: 'Dining', window: 'Window', top: 'Plan' },
};
export const TIME_LABELS = {
  ru: { morning: 'Утро', day: 'День', golden: 'Закат', evening: 'Вечер' },
  en: { morning: 'Morning', day: 'Day', golden: 'Sunset', evening: 'Evening' },
};

export const L = (lang) => (lang === 'en' ? 'en' : 'ru');

export function keyLabel(lang, key, type) {
  const l = L(lang);
  return KEYS[l][key] || TYPES[l][type] || TYPES[l][key] || (l === 'en' ? 'Item' : 'Предмет');
}
export const typeLabel = (lang, type) => TYPES[L(lang)][type] || (L(lang) === 'en' ? 'Item' : 'Предмет');

const nf = { ru: new Intl.NumberFormat('ru-RU'), en: new Intl.NumberFormat('en-US') };
export const num = (lang, n) => nf[L(lang)].format(Math.round(Number(n) || 0));
export const aed = (lang, n) => `${num(lang, n)}${NBSP}AED`;
/** "+350 AED" / "−350 AED" (real minus); '' for zero. */
export const delta = (lang, n) => (Math.round(n) === 0 ? '' : `${n > 0 ? '+' : '−'}${num(lang, Math.abs(n))}${NBSP}AED`);

export function plural(lang, n, forms) {
  if (L(lang) === 'en') return Math.abs(n) === 1 ? forms[0] : forms[1];
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
export const ITEMS = { ru: ['предмет', 'предмета', 'предметов'], en: ['item', 'items'] };

// Category words dropped from the start of a name (the label already says it).
const PREFIX_RU = /^(диван|кресло|журнальный стол(ик)?|приставной стол(ик)?|тв-тумба|тумба под тв|кровать|матрас|постельное бель[её]|комплект постельного белья|постель|прикроватная тумба|тумба|настольная лампа|лампа|обеденный стол|стол|обеденный стул|стул|торшер|подвесной светильник|светильник|ков[её]р|шторы|картина|подушки|декор|кухня|у кровати|растение|искусственная олива|плед|зеркало|дорожка)[\s,:—–-]+/i;
const PREFIX_EN = /^(sofa|armchair|coffee table|side table|tv unit|bed|mattress|bedding( set)?|nightstand|bedside table|bedside|table lamp|lamp|dining table|table|dining chair|chair|floor lamp|pendant( lamp| light)?|rug|curtains?|art|wall art|cushions?|decor( set)?|kitchen|plant|throw|mirror)[\s,:—–-]+/i;

// ---------------------------------------------------------------- display-level name tidy-up (D3-04, D3-05)
// The catalog keeps its names; these only change how they read next to a label. Shared with ui/labels.js.
/** Leading "Label:" a set's name starts with (the slot label already says it). */
const LABEL_RE = { ru: /^(постель|подушки|декор|кухня|у кровати)\s*:\s*/iu, en: /^(bedding|cushions|decor|kitchen|bedside)\s*:\s*/i };
/** The category noun an EN name ends its first clause with ("Lansbury 3-seater sofa", "Sable brass floor lamp, 162 cm"). */
const EN_NOUNS_OF = {
  sofa: ['sofa'], armchair: ['lounge chair', 'armchair', 'chair'], coffee_table: ['coffee table'], side_table: ['side table'],
  tv_unit: ['TV unit'], bed: ['bed'], mattress: ['mattress'], nightstand: ['nightstand'], table_lamp: ['table lamp'],
  dining_table: ['dining table'], dining_chair: ['dining chair', 'chair'], floor_lamp: ['floor lamp'], pendant_lamp: ['pendant'],
  rug: ['rug'], runner: ['runner'], curtains: ['curtains'], mirror: ['mirror'], throw: ['throw'],
};
/** One spelling for sofas: "Brighton three-seat sofa" → "Brighton 3-seater sofa", "three-seat bouclé sofa" → "bouclé 3-seater sofa". */
export const normName = (s) => String(s || '').replace(/\bthree-seat(?:er)?\s+((?:[\p{L}-]+\s+)?)sofa\b/giu, (_, adj) => `${adj}3-seater sofa`);
/** Starts with a set label ("Bedding: …", «Постель: …»)? */
export const hasSetLabel = (lang, name) => LABEL_RE[L(lang)].test(String(name || '').trim());
/**
 * The name under a category label, EN: "Bedding: white percale…" → "white percale…", "Lansbury 3-seater sofa" →
 * "Lansbury 3-seater", "Sable brass floor lamp, 162 cm" → "Sable brass, 162 cm". Case is left as it is.
 */
export function shortEnName(type, name) {
  const s = normName(name).trim();
  const lab = s.match(LABEL_RE.en);
  if (lab) return s.slice(lab[0].length);
  const cut = s.search(/[,:]/);
  const head = cut < 0 ? s : s.slice(0, cut);
  const tail = cut < 0 ? '' : s.slice(cut + 1).trim();
  for (const n of EN_NOUNS_OF[type] || []) {
    const re = new RegExp(`\\s+${n}$`, 'i');
    if (!re.test(head)) continue;
    const h = head.replace(re, '').trim();
    if (!h || /^(square|round|oval|small|large|low)$/i.test(h)) continue;   // "Square dining table" keeps its noun
    return tail ? `${h}, ${tail}` : h;
  }
  return s;
}

/** Spaced sizes, as on the rest of the page: "80×80" → "80 × 80", "Ø90" → "Ø 90" (non-breaking). */
export const pretty = (s) => String(s || '')
  .replace(/(\d)\s*[×x]\s*(\d)/g, `$1${NBSP}×${NBSP}$2`)
  .replace(/Ø\s*(\d)/g, `Ø${NBSP}$1`);

/** Display name in the active language, category word stripped: "Диван Lansbury, трёхместный" → "Lansbury, трёхместный". */
export function itemName(lang, item, { afterLabel = false } = {}) {
  if (!item) return '';
  const en = L(lang) === 'en';
  if (!en && item.shortName) return pretty(item.shortName);
  if (en && item.shortNameEn) return pretty(item.shortNameEn);
  const name = normName(String((en ? item.nameEn : item.name) || item.name || item.nameEn || '').trim());
  // D3-04: after "Постельное бельё:" the item's own «Постель:» is noise — and so is "… sofa" after "Sofa:".
  const setLabel = hasSetLabel(lang, name);
  let rest = afterLabel && en ? shortEnName(item.type, name) : name.replace(en ? PREFIX_EN : PREFIX_RU, '');
  if (rest.length < 2) rest = name;
  const out = pretty(rest);
  if (afterLabel && setLabel) return out;                                           // «белый сатин, овсяный плед»
  if (afterLabel && !en && /^[А-ЯЁ][а-яё]/.test(out)) return out.charAt(0).toLowerCase() + out.slice(1); // «оливковое дерево…»
  return out.charAt(0).toUpperCase() + out.slice(1);
}
export const itemColor = (lang, item) => (L(lang) === 'en' ? item?.colorEn || item?.color : item?.color || item?.colorEn) || '';
export const itemMaterials = (lang, item) => (L(lang) === 'en' ? item?.materialsEn || item?.materials : item?.materials || item?.materialsEn) || [];
export const styleName = (lang, pack) => (L(lang) === 'en' ? pack?.nameEn || pack?.name : pack?.name || pack?.nameEn) || '';
export const quoted = (lang, s) => (L(lang) === 'en' ? String(s) : `«${s}»`); // EN: bare names (D2-15)

/** UI strings. */
export const UI = {
  ru: {
    region: 'Ассистент Villar',
    inputLabel: 'Попросите Villar',
    placeholder: 'Спросите или попросите что угодно',
    placeholderShort: 'Попросите что угодно',
    examples: ['«сделай уютнее»', '«уложись в 25 000 AED»', '«покажи вечер»', '«замени диван на что-то светлее»', '«покажи спальню»', '«подушки потеплее»'],
    hint: 'Например: «покажи вечер», «уложись в 25 000 AED», «диван светлее». Enter — отправить.',
    send: 'Отправить',
    thinking: 'Подбираю',
    undo: 'Отменить',
    undone: 'Изменения отменены.',
    history: 'История',
    hideHistory: 'Скрыть',
    you: 'Вы',
    who: 'Villar',
    clear: 'Очистить',
    chips: 'Подсказки',
    applied: 'Изменения',
    show: 'Показать', hide: 'Скрыть', more: 'Ещё', go: 'Перейти', back: 'Вернуть', freshNote: 'Стиль собран по подборке — «Отменить» вернёт ваш прежний выбор.',
    swaps: (n, d) => `${n}${NBSP}${plural('ru', n, ['замена', 'замены', 'замен'])}${d ? ` · ${d}` : ''}`,
    changes: (n, d) => `${n}${NBSP}${plural('ru', n, ['изменение', 'изменения', 'изменений'])}${d ? ` · ${d}` : ''}`,
    offline: 'Без сети — работаю локально',
    budgetOk: (t, n) => `Итог ${t} · в пределах ${n}`,
    budgetMin: (t) => `Итог ${t} · самый экономный вариант`,
    error: 'Не получилось. Попробуйте сказать по-другому.',
  },
  en: {
    region: 'Villar assistant',
    inputLabel: 'Ask Villar',
    placeholder: 'Ask or request anything',
    placeholderShort: 'Ask for anything',
    examples: ['“make it cosier”', '“keep it under 25,000 AED”', '“show the evening”', '“a lighter sofa”', '“show the bedroom”', '“warmer cushions”'],
    hint: 'For example: “show the evening”, “keep it under 25,000 AED”, “a lighter sofa”. Press Enter to send.',
    send: 'Send',
    thinking: 'Working on it',
    undo: 'Undo',
    undone: 'Changes undone.',
    history: 'History',
    hideHistory: 'Hide',
    you: 'You',
    who: 'Villar',
    clear: 'Clear',
    chips: 'Suggestions',
    applied: 'Changes',
    show: 'Show', hide: 'Hide', more: 'More', go: 'Switch', back: 'Go back', freshNote: 'Started from the style’s set; Undo brings back your earlier picks.',
    swaps: (n, d) => `${n}${NBSP}${plural('en', n, ['swap', 'swaps'])}${d ? ` · ${d}` : ''}`,
    changes: (n, d) => `${n}${NBSP}${plural('en', n, ['change', 'changes'])}${d ? ` · ${d}` : ''}`,
    offline: 'Offline — working locally',
    budgetOk: (t, n) => `Total ${t} · within ${n}`,
    budgetMin: (t) => `Total ${t} · the most economical set`,
    error: 'That didn’t work. Try saying it another way.',
  },
};
export const ui = (lang) => UI[L(lang)];

/** Default follow-up chips for a state (used when the model or the local parser gives none). */
export function defaultChips(lang, { total = 0, time = 'day', view = 'eye' } = {}) {
  const en = L(lang) === 'en';
  const budget = Math.max(5000, Math.floor((total * 0.85) / 1000) * 1000);
  const out = [];
  out.push(time === 'evening' || time === 'golden' ? (en ? 'Show the morning' : 'Покажи утро') : (en ? 'Show the evening' : 'Покажи вечер'));
  out.push(en ? `Keep it under ${num(lang, budget)}${NBSP}AED` : `Уложись в ${num(lang, budget)}${NBSP}AED`);
  out.push(en ? 'A lighter sofa' : 'Диван светлее');
  out.push(view === 'bed' ? (en ? 'Show the living area' : 'Покажи гостиную') : (en ? 'Show the bedroom' : 'Покажи спальню'));
  return out.slice(0, 3);
}
