// Villar assistant — local intent parser (RU + EN). Owner: assistant.
// Runs in the browser when the AI endpoint is unavailable (offline, unauthorized, rate-limited, timed out),
// and as an instant fast path for unambiguous camera/time commands. Pure: no DOM, no network.
//
//   parseLocal(text, { data: { catalog, layout, packs }, style, selection, view, time, lang })
//     → { understood, confidence: 'high'|'low', reply, actions, chips, undo?, budget? }
//
// Every action it returns is validated through core.applyActions (same rules as the server).
import { createSim, foldText, parseBudget, VIEWS } from './core.js';
import { L, keyLabel, itemName, itemColor, aed, num, delta as fmtDelta, plural, ITEMS, styleName, quoted, defaultChips, VIEW_LABELS } from './i18n.js';

// Whole-word match (stems end in \p{L}* so they still match every ending).
const W = (s) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${s})(?![\\p{L}\\p{N}])`, 'gu');

// ---------------------------------------------------------------- lexicon
// Order matters: compound phrases first; each match is blanked out before the next pattern runs.
const TYPE_RX = [
  ['coffee_table', W('журнальн\\p{L}*(?: стол\\p{L}*)?|кофейн\\p{L}* стол\\p{L}*|coffee ?tables?')],
  ['side_table', W('приставн\\p{L}*(?: стол\\p{L}*)?|side ?tables?|end ?tables?')],
  ['tv_unit', W('тумб\\p{L}* под (?:тв|телевиз\\p{L}*)|тв-тумб\\p{L}*|тв(?![\\p{L}])|tv(?: unit| stand| console)?(?![a-z])|телевиз\\p{L}*|media (?:unit|console)')],
  ['nightstand', W('прикроватн\\p{L}*(?: тумб\\p{L}*)?|тумбочк\\p{L}*|nightstands?|night stands?|bedside tables?')],
  ['table_lamp', W('настольн\\p{L}* ламп\\p{L}*|ночник\\p{L}*|table lamps?|bedside lamps?')],
  ['floor_lamp', W('торшер\\p{L}*|floor ?lamps?|standing lamps?')],
  ['pendant_lamp', W('подвесн\\p{L}*(?: светильник\\p{L}*| ламп\\p{L}*)?|подвес(?![\\p{L}])|люстр\\p{L}*|светильник\\p{L}* над стол\\p{L}*|pendants?(?: lamps?| lights?)?|chandeliers?')],
  ['dining_table', W('обеденн\\p{L}* стол\\p{L}*|dining tables?')],
  ['dining_chair', W('обеденн\\p{L}* стул\\p{L}*|dining chairs?')],
  ['kitchen_decor', W('кухонн\\p{L}* (?:декор\\p{L}*|аксессуар\\p{L}*)|чайник\\p{L}*|kitchen (?:decor|accessories)|kettle')],
  ['centerpiece', W('центр стола|букет\\p{L}*|свеч\\p{L}*|centerpiece|centrepiece|candles?')],
  ['mattress', W('матрас\\p{L}*|mattress(?:es)?')],
  ['bedding', W('постельн\\p{L}*(?: бель\\p{L}*)?|бель[еяю](?![\\p{L}])|постел\\p{L}*|bedding|duvet|bed linen|sheets')],
  ['bed', W('кроват\\p{L}*|bed(?: frame)?(?![a-z])')],
  ['sofa', W('диван\\p{L}*|sofas?|couch(?:es)?|settee')],
  ['armchair', W('кресл\\p{L}*|armchairs?|lounge chairs?|accent chairs?')],
  ['dining_chair', W('стул\\p{L}*|стуль\\p{L}*|chairs?(?![a-z])')],
  ['rug', W('ков[её]р\\p{L}*|ковр\\p{L}*|rugs?|carpets?')],
  ['curtains', W('штор\\p{L}*|занавес\\p{L}*|тюл\\p{L}*|curtains?|drapes?|sheers?')],
  ['wall_art', W('картин\\p{L}*|постер\\p{L}*|принт\\p{L}*|art(?:work)?(?![a-z])|paintings?|prints?|posters?')],
  ['plant', W('растен\\p{L}*|цвет(?:ок|ы)(?![\\p{L}])|деревц\\p{L}*|plants?|tree')],
  ['decor_set', W('декор\\p{L}*|ваз[аыуе](?![\\p{L}])|вазы|статуэтк\\p{L}*|decor|vases?|accessor(?:y|ies)')],
  ['cushions', W('подуш\\p{L}*|cushions?|pillows?')],
  ['throw', W('плед\\p{L}*|покрывал\\p{L}*|throws?|blankets?')],
  ['mirror', W('зеркал\\p{L}*|mirrors?')],
  ['tableware', W('посуд\\p{L}*|тарел\\p{L}*|сервиров\\p{L}*|tableware|plates|dinnerware')],
  ['runner', W('дорожк\\p{L}*|runner')],
  ['towels', W('полотенц\\p{L}*|towels?')],
  ['pendant_lamp', W('светильник\\p{L}*|ceiling lights?|light fixtures?')],
  ['table_lamp', W('ламп\\p{L}*|lamps?(?![a-z])')],
  ['dining_table', W('стол(?:а|у|ом|е|ы)?(?![\\p{L}])|tables?(?![a-z])')],
];
// "картина над диваном" — the location picks the wall-art placement and is not a second target.
const ART_LOC = [
  ['art_sofa', /(?:над|у|возле|рядом с)\s+диван\p{L}*|(?:above|over|by)\s+the\s+(?:sofa|couch)|(?:в|in the)\s+гостин\p{L}*|living/u],
  ['art_bed', /(?:над|у|возле)\s+кроват\p{L}*|(?:above|over|by)\s+the\s+bed|(?:в|in the)\s+спальн\p{L}*|bedroom/u],
  ['art_dining', /(?:над|у|возле)\s+стол\p{L}*|(?:в|in the)\s+столов\p{L}*|dining/u],
];
const PREP_BEFORE = /(?:^|\s)(?:на|над|у|в|во|для|возле|около|рядом с|под|к|on|above|over|by|for|near|next to|in|under|to|with|с)\s*$/u;

const COLORS = {
  green: { rx: W('зелен\\p{L}*|олив\\p{L}*|шалфе\\p{L}*|изумруд\\p{L}*|green|olive|sage|emerald'), hsl: ([h, s]) => h >= 55 && h <= 170 && s >= 0.1 },
  terracotta: { rx: W('терракот\\p{L}*|ржав\\p{L}*|кирпич\\p{L}*|рыж\\p{L}*|оранж\\p{L}*|глин\\p{L}*|terracotta|rust\\p{L}*|orange|clay|brick'), hsl: ([h, s, l]) => h >= 5 && h <= 35 && s >= 0.3 && l >= 0.25 && l <= 0.7 },
  red: { rx: W('красн\\p{L}*|бордо\\p{L}*|red|burgundy'), hsl: ([h, s]) => (h <= 12 || h >= 340) && s >= 0.4 },
  beige: { rx: W('беж\\p{L}*|овсян\\p{L}*|песоч\\p{L}*|греж\\p{L}*|натуральн\\p{L}*|beige|oat\\p{L}*|sand\\p{L}*|greige|natural|taupe'), hsl: ([h, s, l]) => h >= 22 && h <= 52 && s >= 0.08 && s <= 0.5 && l >= 0.6 },
  white: { rx: W('бел(?:ый|ая|ое|ые|ого|ую|ым|ых|ее|ей)|молочн\\p{L}*|слонов\\p{L}*|white|milk\\p{L}*|ivory|cream'), hsl: ([, , l]) => l >= 0.86 },
  grey: { rx: W('сер(?:ый|ая|ое|ые|ого|ую|ым|ых)|серо\\p{L}*|grey|gray'), hsl: ([, s, l]) => s <= 0.08 && l >= 0.25 && l <= 0.85 },
  black: { rx: W('черн(?:ый|ая|ое|ые|ого|ую|ым|ых)|black'), hsl: ([, , l]) => l <= 0.18 },
  brown: { rx: W('коричнев\\p{L}*|шоколад\\p{L}*|коньяч\\p{L}*|коньяк\\p{L}*|орехов\\p{L}*|brown|chocolate|cognac|walnut'), hsl: ([h, , l]) => h >= 10 && h <= 45 && l >= 0.12 && l <= 0.5 },
  blue: { rx: W('син(?:ий|яя|ее|ие|его|юю|им|их)|голуб\\p{L}*|индиго|blue|indigo|navy'), hsl: ([h, s]) => h >= 185 && h <= 250 && s >= 0.15 },
  yellow: { rx: W('желт\\p{L}*|охр\\p{L}*|горчич\\p{L}*|yellow|ochre|mustard'), hsl: ([h, s]) => h >= 40 && h <= 60 && s >= 0.35 },
  pink: { rx: W('розов\\p{L}*|пудров\\p{L}*|pink|blush'), hsl: ([h, s, l]) => (h >= 330 || h <= 15) && s >= 0.2 && l >= 0.65 },
  gold: { rx: W('золот\\p{L}*|латун\\p{L}*|gold\\p{L}*|brass'), hsl: ([h, s, l]) => h >= 35 && h <= 50 && s >= 0.3 && l >= 0.35 && l <= 0.65 },
};
const MATERIALS = {
  leather: W('кож\\p{L}*|leather'), boucle: W('букле|boucl\\p{L}*'), linen: W('льн\\p{L}*|лен(?![\\p{L}])|linen'),
  velvet: W('бархат\\p{L}*|велюр\\p{L}*|velvet'), wool: W('шерст\\p{L}*|wool\\p{L}*'), cotton: W('хлоп\\p{L}*|cotton'),
  jute: W('джут\\p{L}*|jute'), rattan: W('ротанг\\p{L}*|плет[её]н\\p{L}*|венск\\p{L}*|rattan|wicker|cane(?![a-z])'),
  travertine: W('травертин\\p{L}*|travertine'), marble: W('мрамор\\p{L}*|marble'), walnut: W('орех\\p{L}*|walnut'),
  oak: W('дуб\\p{L}*|oak'), metal: W('металл\\p{L}*|metal\\p{L}*|steel'), ceramic: W('керамик\\p{L}*|ceramic\\p{L}*'),
  glass: W('стекл\\p{L}*|glass'), wood: W('дерев\\p{L}*|wood\\p{L}*'), stone: W('камен\\p{L}*|камн\\p{L}*|stone'),
  fabric: W('ткан\\p{L}*|fabric|upholster\\p{L}*'),
};
const MODS = {
  lighter: W('светле\\p{L}*|посветле\\p{L}*|светл(?:ый|ая|ое|ые|ого|ую|ым|ых)|lighter|light(?![a-z])|brighter|paler'),
  darker: W('темне\\p{L}*|потемне\\p{L}*|темн(?:ый|ая|ое|ые|ого|ую|ым|ых)|darker|dark(?![a-z])|deeper'),
  warmer: W('тепле\\p{L}*|потепле\\p{L}*|тепл(?:ый|ая|ое|ые|ого|ую|ым|ых)|warmer|warm(?![a-z])'),
  cooler: W('холодне\\p{L}*|похолодне\\p{L}*|прохладн\\p{L}*|холодн(?:ый|ая|ое|ые)|cooler|cool(?![a-z])'),
  cheaper: W('подешевл\\p{L}*|дешевл\\p{L}*|дешев\\p{L}*|бюджетн\\p{L}*|эконом\\p{L}*|сэконом\\p{L}*|недорог\\p{L}*|cheaper|cheap(?:est)?(?![a-z])|less expensive|affordable|save money|budget[- ]friendly'),
  pricier: W('подорож\\p{L}*|дороже|дорог(?:ой|ая|ое|ие)|премиальн\\p{L}*|роскошн\\p{L}*|получше|лучше|pricier|premium|upgrade|luxur\\p{L}*|nicer|better|fancier'),
  smaller: W('меньше|поменьше|компактн\\p{L}*|smaller|compact'),
  bigger: W('больше|побольше|крупне\\p{L}*|bigger|larger'),
  another: W('друг(?:ой|ая|ое|ие|ую|ого)|замени\\p{L}*|замен\\p{L}*|поменя\\p{L}*|смени\\p{L}*|ещ[её] вариант\\p{L}*|иначе|another|different|swap|change|replace|next|other'),
};
const VIEW_RX = {
  eye: W('вход\\p{L}*|прихож\\p{L}*|коридор\\p{L}*|у двери|entry|entrance|hallway|front door'),
  living: W('гостин\\p{L}*|зал(?![\\p{L}])|living(?: room| area)?|lounge'),
  bed: W('спальн\\p{L}*|bedroom|sleeping area'),
  dining: W('столов\\p{L}*|кухн\\p{L}*|обеденн\\p{L}* зон\\p{L}*|dining(?: room| area)?|kitchen'),
  window: W('у окна|окн\\p{L}*|окош\\p{L}*|панорам\\p{L}*|балкон\\p{L}*|windows?|skyline'),
  top: W('план(?![\\p{L}])|плана|планировк\\p{L}*|сверху|вид сверху|с высоты|top(?: view)?(?![a-z])|plan(?![a-z])|floor ?plan|overhead|bird\\p{L}*|dollhouse'),
};
const TIME_RX = {
  morning: W('утр\\p{L}*|рассвет\\p{L}*|morning|sunrise|dawn'),
  golden: W('закат\\p{L}*|золот\\p{L}* час\\p{L}*|sunset|golden(?: hour)?|dusk'),
  evening: W('вечер\\p{L}*|ноч\\p{L}*|сумерк\\p{L}*|evening|night\\p{L}*'),
  day: W('дн[её]м|днев\\p{L}*|день|полд(?:ень|ня)|daytime|daylight|day(?![a-z])|noon|midday'),
};
const RX = {
  undo: W('отмени\\p{L}*|отмена|верни (?:как было|обратно|назад)|undo|revert|take (?:it|that) back'),
  reset: W('сброс\\p{L}*|сбрось|по умолчанию|исходн\\p{L}*|с нуля|заново|начать сначала|начни сначала|reset|start over|default|original set'),
  help: W('что (?:ты )?умеешь|помощь|помоги|что можно|help|what can you do|how does (?:this|it) work|как (?:это )?работает'),
  cozy: W('уют\\p{L}*|cozy|cosy|cozier|cosier|hygge|атмосферн\\p{L}*|романтичн\\p{L}*|romantic'),
  show: W('покаж\\p{L}*|показ\\p{L}*|где(?![\\p{L}])|посмотр\\p{L}*|глян\\p{L}*|перейд\\p{L}*|перейти|приблиз\\p{L}*|show|look at|go to|take me|where|zoom|focus'),
  price: W('сколько сто\\p{L}*|цена|цену|почем|how much|price|cost'),
  total: W('итог\\p{L}*|всего|в сумме|сколько (?:выходит|получается)|total|overall cost|altogether'),
  keep: W('остав\\p{L}*|сохран\\p{L}*|не трога\\p{L}*|не меня\\p{L}*|кроме|keep|except|leave|but not'),
  style: W('стил\\p{L}*|style|в духе|look|vibe'),
};
const FILLER = W('покажи|покажите|показать|show|me|the|a|an|please|пожалуйста|давай|давайте|сделай|сделайте|включи|включите|переключи|перейди|хочу|мне|можно|можешь|could|can|you|would|i|want|to|go|let\'?s|lets|now|теперь|сейчас|в|во|на|к|у|и|а|of|in|at|for|with|from|by|into|view|вид|вид(?:а|ом|у)|режим|время|суток|time|ракурс|камер\\p{L}*|camera|свет|light(?:ing)?|освещение|посмотреть|look|switch|turn|on|mode|зону|зона|area|room|комнат\\p{L}*');

// ---------------------------------------------------------------- color math
function hexRgb(hex) {
  let x = String(hex || '').trim().replace('#', '');
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(x)) return null;
  if (x.length === 3) x = [...x].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
}
function hsl(hex) {
  const rgb = hexRgb(hex); if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
const lum = (hex) => { const c = hexRgb(hex); if (!c) return 0.5; const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const warmth = (hex) => { const c = hexRgb(hex); return c ? (c[0] - c[2]) / 255 : 0; };
const area = (it) => (Number(it?.dims?.w) || 0) * (Number(it?.dims?.d) || 0);
const itemText = (it) => foldText([it?.name, it?.nameEn, it?.color, it?.colorEn, ...(it?.materials || []), ...(it?.materialsEn || [])].join(' '));

// ---------------------------------------------------------------- matching helpers
/** Find and blank all matches of rx in a mutable text holder; returns [{ index, text }]. */
function take(h, rx) {
  const found = [];
  rx.lastIndex = 0;
  h.t = h.t.replace(rx, (m, ...args) => {
    const index = args[args.length - 2];
    found.push({ index, text: m });
    return ' '.repeat(m.length);
  });
  return found;
}
const has = (h, rx) => { rx.lastIndex = 0; return rx.test(h.t); };

// ---------------------------------------------------------------- phrases
const P = {
  ru: {
    view: { eye: 'Вид от входа.', living: 'Гостиная.', bed: 'Спальня.', dining: 'Столовая.', window: 'Вид от окна.', top: 'План сверху.' },
    time: { morning: 'Утро: мягкий рассеянный свет.', day: 'День: ровный свет от окна.', golden: 'Закат: тёплое низкое солнце.', evening: 'Вечер: лампы включены.' },
    cozy: 'Тёплый вечерний свет и лампы — так студия уютнее.',
    cozyPlus: 'Вечерний свет и подушки потеплее — так уютнее.',
    lighter: (n) => `${n} — светлее.`, darker: (n) => `${n} — темнее.`,
    warmer: (n) => `${n} — теплее по тону.`, cooler: (n) => `${n} — прохладнее по тону.`,
    cheaper: (n, s) => `${n} — на ${s} дешевле.`, pricier: (n) => `${n} — самый выразительный вариант в этом стиле.`,
    smaller: (n) => `${n} — компактнее.`, bigger: (n) => `${n} — крупнее.`,
    color: (n, c) => `${n}, ${c.toLowerCase()}.`, material: (n) => `${n} — подходит по материалу.`,
    another: (n) => `${n} — другой вариант.`,
    many: (k, d) => `Обновлено: ${k} ${plural('ru', k, ITEMS.ru)}${d ? `, итог ${d}` : ''}.`,
    noBetter: { lighter: 'светлее', darker: 'темнее', warmer: 'теплее', cooler: 'прохладнее', cheaper: 'дешевле', pricier: 'дороже', smaller: 'компактнее', bigger: 'крупнее' },
    already: (lbl, w) => `${lbl}: ${w} в этом стиле нет — сейчас лучший вариант.`,
    noMatch: (lbl) => `${lbl}: подходящего варианта в этом стиле нет.`,
    noType: (lbl) => `${lbl}: в этом стиле пока нет вариантов.`,
    cheapestAll: (s) => `Самый экономный вариант этого стиля: минус ${s}.`,
    cheapestAlready: 'Это уже самый экономный вариант стиля.',
    budgetOk: (k, t) => `Готово: ${k} ${plural('ru', k, ['замена', 'замены', 'замен'])}, итог ${t}.`,
    budgetAlready: (t) => `Вы уже укладываетесь: итог ${t}.`,
    budgetMin: (m) => `Ниже ${m} в этом стиле не получится — вот самый экономный вариант.`,
    budgetPlan: (n, lvl, t) => `Комната под ${n}: «${lvl}», итог ${t}.`,
    budgetMinLevel: 'Минимум', budgetBasicsLevel: 'Основа',
    style: (n, k) => `Стиль ${n}: обновлено ${k} ${plural('ru', k, ITEMS.ru)}.`,
    styleCantKeep: (a) => `Оставить ${a.noun.toLowerCase()} «${a.from}» не получится: в этом стиле такой модели нет. Вместо него — «${a.to}»${a.diff ? ` (${a.diff})` : ''}.`,
    styleSame: (n) => `Стиль ${n} уже выбран.`,
    reset: (n) => `Исходная подборка стиля ${n} восстановлена.`,
    resetSame: 'Всё и так как в исходной подборке.',
    resetBack: (n, prev) => `Это и есть исходная подборка стиля ${n}. Вернуть стиль ${prev}, как было?`,
    resetBackChip: (prev) => `Вернуть ${prev}`,
    elsewhere: (lbl, n, it, pr) => `${lbl}: в этом стиле такого нет, но есть в стиле ${n} — «${it}», ${pr}.`,
    elsewhereChip: (n, it) => `Перейти в ${n} с «${it}»`,
    elsewhereDone: (n, it) => `Стиль ${n} с «${it}».`,
    focus: (n, p) => `${n}, ${p}.`,
    price: (n, p, q) => `${n} — ${p}${q > 1 ? ` за ${q} шт.` : ''}.`,
    total: (t) => `Итог по квартире — ${t}.`,
    undo: 'Последние изменения отменены.',
    nothingToUndo: 'Пока нечего отменять.',
    help: 'Могу показать зону или время суток, сменить стиль и подобрать вещи по цене, цвету или материалу. Например: «покажи вечер», «уложись в 25 000 AED», «диван светлее».',
    unknown: 'Пока я понимаю простые просьбы. Например: «покажи вечер», «уложись в 25 000 AED», «диван светлее».',
  },
  en: {
    view: { eye: 'The view from the entry.', living: 'Living.', bed: 'Bedroom.', dining: 'Dining.', window: 'The view from the window.', top: 'The plan from above.' },
    time: { morning: 'Morning: soft, diffused light.', day: 'Day: even light from the window.', golden: 'Sunset: warm, low sun.', evening: 'Evening: lamps on.' },
    cozy: 'Warm evening light and the lamps on — it feels cosier.',
    cozyPlus: 'Evening light and warmer cushions — cosier.',
    lighter: (n) => `${n} — lighter.`, darker: (n) => `${n} — darker.`,
    warmer: (n) => `${n} — a warmer tone.`, cooler: (n) => `${n} — a cooler tone.`,
    cheaper: (n, s) => `${n} — ${s} less.`, pricier: (n) => `${n} — the statement piece of this style.`,
    smaller: (n) => `${n} — more compact.`, bigger: (n) => `${n} — larger.`,
    color: (n, c) => `${n}, ${c.toLowerCase()}.`, material: (n) => `${n} — the material you asked for.`,
    another: (n) => `${n} — another option.`,
    many: (k, d) => `Updated ${k} ${plural('en', k, ITEMS.en)}${d ? `, total ${d}` : ''}.`,
    noBetter: { lighter: 'lighter', darker: 'darker', warmer: 'warmer', cooler: 'cooler', cheaper: 'cheaper', pricier: 'pricier', smaller: 'smaller', bigger: 'larger' },
    already: (lbl, w) => `${lbl}: nothing ${w} in this style — this is the best match.`,
    noMatch: (lbl) => `${lbl}: no matching option in this style.`,
    noType: (lbl) => `${lbl}: no options in this style yet.`,
    cheapestAll: (s) => `The most economical version of this style: ${s} less.`,
    cheapestAlready: 'This is already the most economical set.',
    budgetOk: (k, t) => `Done: ${k} ${plural('en', k, ['swap', 'swaps'])}, total ${t}.`,
    budgetAlready: (t) => `You’re already within budget: total ${t}.`,
    budgetMin: (m) => `This style can’t go below ${m} — here is the most economical set.`,
    budgetPlan: (n, lvl, t) => `Room for ${n}: ${lvl}, total ${t}.`,
    budgetMinLevel: 'Minimum', budgetBasicsLevel: 'Basics',
    style: (n, k) => `${n} style: ${k} ${plural('en', k, ITEMS.en)} updated.`,
    styleCantKeep: (a) => `${a.label} isn’t part of this style, so ${a.toFull} takes its place${a.diff ? ` (${a.diff})` : ''}.`,
    styleSame: (n) => `${n} is already the active style.`,
    reset: (n) => `Back to the original ${n} set.`,
    resetSame: 'Everything is already the original set.',
    resetBack: (n, prev) => `This is the original ${n} set. Go back to ${prev}, as it was?`,
    resetBackChip: (prev) => `Back to ${prev}`,
    elsewhere: (lbl, n, it, pr) => `${lbl}: not in this style, but ${n} has “${it}”, ${pr}.`,
    elsewhereChip: (n, it) => `Switch to ${n} with “${it}”`,
    elsewhereDone: (n, it) => `${n} style with “${it}”.`,
    focus: (n, p) => `${n}, ${p}.`,
    price: (n, p, q) => `${n} — ${p}${q > 1 ? ` for ${q}` : ''}.`,
    total: (t) => `The apartment total is ${t}.`,
    undo: 'Undid the last changes.',
    nothingToUndo: 'Nothing to undo yet.',
    help: 'I can show a zone or a time of day, switch the style, and pick items by price, colour or material. Try “show the evening”, “keep it under 25,000 AED”, “a lighter sofa”.',
    unknown: 'I understand simple requests for now — try “show the evening”, “keep it under 25,000 AED” or “a lighter sofa”.',
  },
};

const EN_NOUNS = /\b(sofa|couch|armchair|chair|table|unit|bed|mattress|bedding|duvet|nightstand|lamp|pendant|light|rug|runner|curtains?|art|print|painting|triptych|canvas|plant|tree|olive|decor|vase|set|cushions?|throw|mirror|tableware|centerpiece)s?\b/i;
/** "Диван: Doree, трёхместный" / "Doree 3-seater sofa" (EN names already carry the noun). Subtitles after " — " dropped. */
function labelled(lang, key, type, item) {
  const name = itemName(lang, item).split(' — ')[0].trim();
  if (L(lang) === 'en' && EN_NOUNS.test(name)) return name;
  return `${keyLabel(lang, key, type)}: ${itemName(lang, item, { afterLabel: true }).split(' — ')[0].trim()}`;
}

/** How many selection keys of the new state differ from the old one (slot by slot, across packs). */
export function changedCount(sim, s0, s1) {
  const p0 = sim.pack(s0.style), p1 = sim.pack(s1.style);
  const keys = new Set();
  for (const slot of sim.slots) {
    const a = s0.selection[sim.keyOfSlotIn(p0, slot)], b = s1.selection[sim.keyOfSlotIn(p1, slot)];
    if (a !== b) keys.add(sim.keyOfSlotIn(p1, slot));
  }
  return keys.size;
}

// ---------------------------------------------------------------- parser
export function parseLocal(text, ctx) {
  const lang = L(ctx?.lang);
  const p = P[lang];
  const data = ctx?.data || {};
  const sim = ctx?.sim || createSim(data);
  let style = sim.pack(ctx?.style) ? ctx.style : sim.packIds[0];
  let selection = sim.normalizeSelection(style, ctx?.selection);
  const pins0 = Array.isArray(ctx?.pins) ? ctx.pins : [];
  const state0 = { style, selection, pins: pins0 };
  const total0 = sim.total(style, selection);
  const h = { t: ` ${foldText(text)} ` };
  const out = { understood: false, confidence: 'low', reply: '', actions: [], chips: [], intents: [] };
  const finish = (o) => {
    if (!o.chips?.length) {
      const t = o.actions?.find((a) => a.type === 'time')?.name || ctx?.time;
      const v = o.actions?.find((a) => a.type === 'view')?.name || ctx?.view;
      o.chips = defaultChips(lang, { total: o.total ?? total0, time: t, view: v }).filter((c) => foldText(c) !== foldText(text));
    }
    return o;
  };
  if (!h.t.trim()) return finish({ ...out, reply: p.help });

  // 1. undo / help
  if (take(h, RX.undo).length) return finish({ ...out, understood: true, confidence: 'high', undo: true, reply: p.undo, intents: ['undo'] });
  if (has(h, RX.help)) return finish({ ...out, understood: true, confidence: 'high', reply: p.help, intents: ['help'] });

  const raw = [];
  const intents = [];
  const lines = [];

  // 2. style (full names first, then a distinctive word + a style cue)
  let styleTo = null;
  for (const id of sim.packIds) {
    const pk = sim.pack(id);
    const names = [pk.name, pk.nameEn, id.replace(/-/g, ' ')].filter(Boolean).map(foldText).filter((n) => n.length >= 3);
    for (const n of names) {
      const rx = new RegExp(`(?<![\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\p{L}*`, 'gu');
      if (take(h, rx).length) { styleTo = id; break; }
    }
    if (styleTo) break;
  }
  if (!styleTo && has(h, RX.style)) {
    outer: for (const id of sim.packIds) {
      const pk = sim.pack(id);
      for (const w of foldText([pk.name, pk.nameEn].join(' ')).split(' ')) {
        if (w.length < 4 || /^(стил|style|the|and)/.test(w)) continue;
        const stem = w.slice(0, Math.max(4, w.length - 2));
        if (take(h, W(`${stem}\\p{L}*`)).length) { styleTo = id; break outer; }
      }
    }
  }

  // 3. budget, keep/protect cue
  const target = parseBudget(text);
  if (target) h.t = h.t.replace(/\d[\d\s.,]*(?:\s*(?:k(?![a-z])|к(?!\p{L})|тыс\p{L}*|thousand|aed|дирхам\p{L}*|dhs?(?![a-z])))?/gu, (m) => ' '.repeat(m.length));
  const keepAt = (() => { RX.keep.lastIndex = 0; const m = RX.keep.exec(h.t); return m ? m.index : -1; })();
  if (keepAt >= 0) take(h, RX.keep);

  // 4. types (with positions) — art placement first
  let artKey = null;
  for (const [key, rx] of ART_LOC) {
    const m = h.t.match(rx);
    if (m && /картин|постер|принт|art|painting|print|poster/u.test(h.t)) { artKey = key; h.t = h.t.replace(rx, (x) => ' '.repeat(x.length)); break; }
  }
  const typeHits = [];
  for (const [type, rx] of TYPE_RX) for (const f of take(h, rx)) typeHits.push({ type, index: f.index });
  typeHits.sort((a, b) => a.index - b.index);
  // A type right after a preposition that follows another type is a modifier ("подушки на диване").
  const targetsRaw = typeHits.filter((hit, i) => {
    if (i === 0) return true;
    const before = foldText(text).slice(0, Math.max(0, hit.index - 1));
    return !PREP_BEFORE.test(` ${before}`);
  });
  // "диван оставь" / "keep the sofa": a type in the same clause as the keep cue is protected, not a target.
  const seps = [0];
  for (const m of foldText(text).matchAll(/[,.;!?]|\s(?:но|а|и|but|and|while)\s/gu)) seps.push(m.index + 1);
  seps.push(Infinity);
  const clauseOf = (i) => { for (let j = 0; j < seps.length - 1; j++) if (i >= seps[j] && i < seps[j + 1]) return j; return -1; };
  const isProtected = (x) => keepAt >= 0 && clauseOf(x.index) === clauseOf(keepAt);
  const protectTypes = targetsRaw.filter(isProtected).map((x) => x.type);
  const targetTypes = [...new Set(targetsRaw.filter((x) => !isProtected(x)).map((x) => x.type))];

  // 5. modifiers, colours, materials ("вместо кожи" / "instead of leather" / "без кожи" → avoid it)
  const negColors = [], negMats = [];
  h.t = h.t.replace(/(?<![\p{L}])(вместо|кроме|без|не|instead of|rather than|not|no|without)\s+(\p{L}+)/gu, (m, cue, word) => {
    const w = ` ${word} `;
    const c = Object.keys(COLORS).find((k) => { COLORS[k].rx.lastIndex = 0; return COLORS[k].rx.test(w); });
    const mt = Object.keys(MATERIALS).find((k) => { MATERIALS[k].lastIndex = 0; return MATERIALS[k].test(w); });
    if (c) negColors.push(c); else if (mt) negMats.push(mt); else return m;
    return ' '.repeat(m.length);
  });
  const mods = Object.keys(MODS).filter((m) => take(h, MODS[m]).length);
  const colors = Object.keys(COLORS).filter((c) => take(h, COLORS[c].rx).length);
  const mats = Object.keys(MATERIALS).filter((m) => take(h, MATERIALS[m]).length);

  // 6. scene words
  const views = VIEWS.filter((v) => take(h, VIEW_RX[v]).length);
  const times = Object.keys(TIME_RX).filter((tt) => take(h, TIME_RX[tt]).length);
  const wantsReset = take(h, RX.reset).length > 0;
  const cozy = take(h, RX.cozy).length > 0;
  const show = take(h, RX.show).length > 0;
  const askPrice = take(h, RX.price).length > 0;
  const askTotal = take(h, RX.total).length > 0;
  take(h, RX.style);

  // keys of the (possibly new) pack for a type
  const keysFor = (type, pk = style) => {
    const keys = sim.placedKeys(pk).filter((k) => sim.typeOfKey(pk, k) === type);
    if (type === 'wall_art' && artKey && keys.includes(artKey)) return [artKey];
    return keys;
  };

  // ---- style switch
  const styleLost = [];
  if (styleTo) {
    if (styleTo === style && !targetTypes.length) lines.push(p.styleSame(quoted(lang, styleName(lang, sim.pack(styleTo)))));
    else if (styleTo !== style) {
      // "…, диван оставь": keep the current item of a protected type if the new pack offers it.
      let anchor = null;
      const tp = sim.pack(styleTo);
      for (const t of protectTypes) {
        const k = keysFor(t)[0];
        const slotId = k && sim.slotsForKey(sim.pack(style), k)[0]?.id;
        const itemId = k && selection[k];
        if (slotId && itemId && tp.slots?.[sim.keyIn(tp, slotId)]?.options?.includes(itemId)) { anchor = { slotId, itemId }; break; }
        // Asked to keep it, but the new pack doesn't offer it: say so instead of silently replacing it.
        if (slotId && itemId) styleLost.push({ slotId, key: k, type: t, from: itemId, toKey: sim.keyIn(tp, slotId) });
      }
      raw.push({ type: 'style', styleId: styleTo, anchorItemId: anchor?.itemId, anchor });
      const ss = sim.styleSelection(styleTo, anchor);
      style = styleTo; selection = ss.selection;
      intents.push('style');
    }
  }

  // ---- reset
  if (wantsReset) {
    raw.push({ type: 'reset' });
    selection = sim.defaults(style);
    intents.push('reset');
  }

  // ---- budget
  let budgetInfo = null;
  if (target && sim.hasBudget?.()) {
    // The budget slider's planner (core/budget.js): the richest designer-correct room ≤ target, around the
    // customer's pins — exactly where dragging the slider to `target` lands. Pins count only in the same style.
    // «…, диван оставь»: the kept pieces become pins (the client pins them before it asks the server), so the
    // planner keeps them at every budget.
    const keep = protectTypes.flatMap((t) => keysFor(t)).filter((k) => selection[k] != null);
    const pins = style === state0.style ? [...new Set([...pins0, ...keep])] : [];
    state0.pins = pins;
    const plan = sim.planBudget(style, target, { selection, pins });
    if (plan) {
      raw.push({ type: 'budget', amount: target });
      selection = plan.selection;
      budgetInfo = { target, total: plan.total, ok: plan.ok, min: plan.min, level: plan.level || null, index: plan.index, plan: true, keep: style === state0.style ? keep : [] };
      intents.push('budget');
    }
  } else if (target) {
    const protect = protectTypes.flatMap((t) => keysFor(t));
    const fit = sim.fitBudget(style, selection, target, { protect });
    for (const s of fit.swaps) raw.push({ type: 'select', key: s.key, itemId: s.to });
    selection = fit.selection;
    budgetInfo = { target, total: fit.total, ok: fit.ok, min: fit.min, swaps: fit.swaps.length, already: !fit.swaps.length && fit.ok };
    intents.push('budget');
  }

  // ---- per-type swaps
  const picked = []; // { key, item, mod }
  const choose = (key, mod) => {
    const opts = sim.options(style, key);
    const cur = sim.items.get(selection[key]);
    if (!opts.length || !cur) return { none: true };
    const others = opts.filter((o) => o.id !== cur.id);
    let best = null;
    const by = (score, better) => { for (const o of others) { const s = score(o); if (better(s) && (!best || s.rank < best.rank)) best = { item: o, rank: s.rank }; } };
    const price = (o) => +o.price || 0;
    switch (mod) {
      case 'cheaper': { const c = opts.reduce((a, b) => (price(b) < price(a) ? b : a)); return c.id === cur.id ? { none: true } : { item: c }; }
      case 'pricier': { const c = opts.reduce((a, b) => (price(b) > price(a) ? b : a)); return c.id === cur.id ? { none: true } : { item: c }; }
      // A noticeable step in the asked direction, closest in price (a designer would not add 1 800 AED unasked).
      case 'lighter': by((o) => { const d = lum(o.colorHex) - lum(cur.colorHex); return { d, rank: Math.abs(price(o) - price(cur)) / 1000 + Math.abs(d - 0.1) * 5 }; }, (s) => s.d > 0.02); break;
      case 'darker': by((o) => { const d = lum(cur.colorHex) - lum(o.colorHex); return { d, rank: Math.abs(price(o) - price(cur)) / 1000 + Math.abs(d - 0.1) * 5 }; }, (s) => s.d > 0.02); break;
      case 'warmer': by((o) => { const d = warmth(o.colorHex) - warmth(cur.colorHex); return { d, rank: Math.abs(price(o) - price(cur)) / 1000 + Math.abs(d - 0.15) * 4 }; }, (s) => s.d > 0.03); break;
      case 'cooler': by((o) => { const d = warmth(cur.colorHex) - warmth(o.colorHex); return { d, rank: Math.abs(price(o) - price(cur)) / 1000 + Math.abs(d - 0.15) * 4 }; }, (s) => s.d > 0.03); break;
      case 'smaller': by((o) => { const d = area(cur) - area(o); return { d, rank: Math.abs(price(o) - price(cur)) / 1000 - d / 20000 }; }, (s) => s.d > 0); break;
      case 'bigger': by((o) => { const d = area(o) - area(cur); return { d, rank: Math.abs(price(o) - price(cur)) / 1000 - d / 20000 }; }, (s) => s.d > 0); break;
      case 'another': { const i = opts.findIndex((o) => o.id === cur.id); return { item: opts[(i + 1) % opts.length] }; }
      default: return { none: true };
    }
    return best ? { item: best.item } : { none: true };
  };
  const scoreMatch = (o) => {
    const tx = itemText(o);
    const hx = hsl(o.colorHex);
    let s = 0;
    for (const c of colors) { COLORS[c].rx.lastIndex = 0; if (COLORS[c].rx.test(tx)) s += 2; if (hx && COLORS[c].hsl(hx)) s += 1; }
    for (const m of mats) { MATERIALS[m].lastIndex = 0; if (MATERIALS[m].test(tx)) s += 2; }
    for (const c of negColors) { COLORS[c].rx.lastIndex = 0; if (COLORS[c].rx.test(tx)) s -= 3; }
    for (const m of negMats) { MATERIALS[m].lastIndex = 0; if (MATERIALS[m].test(tx)) s -= 3; }
    return s;
  };
  const chooseMatch = (key) => {
    const opts = sim.options(style, key);
    const cur = sim.items.get(selection[key]);
    if (!opts.length || !cur) return { none: true };
    const scored = opts.map((o) => ({ o, s: scoreMatch(o) })).sort((a, b) => b.s - a.s || Math.abs(a.o.price - cur.price) - Math.abs(b.o.price - cur.price));
    const onlyNeg = !colors.length && !mats.length;
    if (!scored[0] || scored[0].s < 0 || (!onlyNeg && scored[0].s <= 0)) return { none: true };
    if (scored[0].o.id === cur.id || scoreMatch(cur) >= scored[0].s) return { already: true, item: cur };
    return { item: scored[0].o };
  };

  // PT-14: what the visitor asked for may exist in another style — offer it instead of a dead end.
  const offers = [];
  const findElsewhere = (key, type) => {
    if (!colors.length && !mats.length) return null;
    let best = null;
    for (const pid of sim.packIds) {
      if (pid === style) continue;
      const k = sim.keyIn ? sim.keyIn(pid, key) : key;
      for (const o of sim.options(pid, k)) {
        const sc = scoreMatch(o);
        if (sc > 0 && (!best || sc > best.sc)) best = { pid, key: k, item: o, sc, type };
      }
    }
    return best;
  };
  const swapMods = mods.filter((m) => m !== 'another' || (!colors.length && !mats.length && mods.length === 1));
  const primaryMod = swapMods.find((m) => m !== 'another') || (swapMods.includes('another') ? 'another' : null);
  const wantsMatch = colors.length || mats.length || negColors.length || negMats.length;

  if (targetTypes.length && !target) {
    for (const t of targetTypes) {
      const keys = keysFor(t);
      if (!keys.length) { lines.push(p.noType(keyLabel(lang, null, t))); continue; }
      for (const key of keys) {
        const lbl = keyLabel(lang, key, t);
        if (wantsMatch) {
          const r = chooseMatch(key);
          if (r.item && !r.already) picked.push({ key, item: r.item, mod: colors.length ? 'color' : 'material' });
          else if (r.already) lines.push(lang === 'en' ? `${labelled(lang, key, t, r.item)} already fits.` : `${labelled(lang, key, t, r.item)} — уже то, что нужно.`);
          else {
            const alt = findElsewhere(key, t);
            if (alt) {
              const sName = quoted(lang, styleName(lang, sim.pack(alt.pid)));
              const short = itemName(lang, alt.item).split(' — ')[0].split(',')[0].trim();
              lines.push(p.elsewhere(lbl, sName, short, aed(lang, alt.item.price * (sim.qty(alt.pid, alt.key) || 1))));
              // PT3-04: the line itself carries the decisive part — «Pebble · 1 799 AED · Перейти».
              const what = `${short} · ${aed(lang, alt.item.price * (sim.qty(alt.pid, alt.key) || 1))}`;
              if (!offers.length) offers.push({ label: p.elsewhereChip(sName, short), short: what, reply: p.elsewhereDone(sName, short), actions: [{ type: 'style', styleId: alt.pid, anchor: { key: alt.key, itemId: alt.item.id } }] });
            } else lines.push(p.noMatch(lbl));
          }
        } else if (primaryMod) {
          const r = choose(key, primaryMod);
          if (r.item) picked.push({ key, item: r.item, mod: primaryMod });
          else lines.push(p.already(lbl, p.noBetter[primaryMod] || ''));
        } else if (askPrice) {
          const it = sim.items.get(selection[key]);
          const q = sim.qty(style, key);
          if (it) lines.push(p.price(labelled(lang, key, t, it), aed(lang, it.price * q), q));
          intents.push('price');
        } else {
          // "покажи диван" / just "диван" → frame it
          const slotId = sim.slotsForKey(sim.pack(style), key)[0]?.id;
          if (slotId && !raw.some((a) => a.type === 'focus')) {
            raw.push({ type: 'focus', slotId });
            const it = sim.items.get(selection[key]);
            if (it) lines.push(p.focus(labelled(lang, key, t, it), aed(lang, it.price * sim.qty(style, key))));
            intents.push('focus');
          }
          break;
        }
      }
    }
  } else if (!target && (primaryMod === 'cheaper') && !targetTypes.length) {
    // whole room: cheapest option everywhere
    let saving = 0;
    for (const key of sim.placedKeys(style)) {
      const r = choose(key, 'cheaper');
      if (r.item) { saving += ((+sim.items.get(selection[key])?.price || 0) - r.item.price) * sim.qty(style, key); raw.push({ type: 'select', key, itemId: r.item.id }); }
    }
    lines.push(saving > 0 ? p.cheapestAll(aed(lang, saving)) : p.cheapestAlready);
    intents.push('cheaper');
  } else if (!target && wantsMatch && !targetTypes.length) {
    // "что-нибудь зелёное" → the single best match anywhere
    let best = null;
    for (const key of sim.placedKeys(style)) {
      for (const o of sim.options(style, key)) {
        if (o.id === selection[key]) continue;
        const s = scoreMatch(o);
        if (s > 0 && (!best || s > best.s)) best = { key, item: o, s };
      }
    }
    if (best) picked.push({ key: best.key, item: best.item, mod: colors.length ? 'color' : 'material' });
  } else if (!targetTypes.length && !target) {
    if (mods.includes('lighter') && !times.length) times.push('day');
    if (mods.includes('darker') && !times.length) times.push('golden');
    if (mods.includes('warmer') && !cozy) intents.push('cozy-warm');
  }
  for (const pk of picked) raw.push({ type: 'select', key: pk.key, itemId: pk.item.id });

  // ---- cosy: evening light (+ the warmest cushions if they are not warm yet)
  if (cozy || intents.includes('cozy-warm')) {
    if (!times.length) times.push('evening');
    const ck = keysFor('cushions')[0];
    if (ck && !picked.length && !target) {
      const r = choose(ck, 'warmer');
      if (r.item && warmth(r.item.colorHex) > 0.25) { raw.push({ type: 'select', key: ck, itemId: r.item.id }); picked.push({ key: ck, item: r.item, mod: 'cozy' }); }
    }
    intents.push('cozy');
  }

  // ---- scene
  if (times.length) { raw.push({ type: 'time', name: times[times.length - 1] }); intents.push('time'); }
  if (views.length) {
    let v = views[views.length - 1];
    // "покажи кровать в спальне": the focus already frames it
    if (!raw.some((a) => a.type === 'focus')) { raw.push({ type: 'view', name: v }); intents.push('view'); }
  }
  if (askTotal && !targetTypes.length) intents.push('total');

  // ---- validate exactly like the server
  const res = sim.applyActions(state0, raw);
  const total1 = sim.total(res.state.style, res.state.selection);
  const nSel = res.actions.filter((a) => a.type === 'select').length;

  // ---- reply
  const replyParts = [];
  if (intents.includes('style')) {
    const st = res.actions.find((a) => a.type === 'style');
    if (st) replyParts.push(p.style(quoted(lang, styleName(lang, sim.pack(st.styleId))), changedCount(sim, state0, res.state)));
    if (st && !st.anchor) for (const l of styleLost.slice(0, 1)) {
      const fromItem = sim.items.get(l.from), toItem = sim.items.get(res.state.selection[l.toKey]);
      if (fromItem && toItem && toItem.id !== fromItem.id) {
        const full = (it) => itemName(lang, it).split(' — ')[0].trim();
        const short = (it) => full(it).split(',')[0].trim();
        const diff = fmtDelta(lang, ((+toItem.price || 0) - (+fromItem.price || 0)) * (sim.qty(res.state.style, l.toKey) || 1));
        replyParts.push(p.styleCantKeep({ label: labelled(lang, l.key, l.type, fromItem), noun: keyLabel(lang, l.key, l.type), from: short(fromItem), to: short(toItem), toFull: full(toItem), diff }));
      }
    }
  }
  if (intents.includes('reset')) {
    const changedKeys = Object.keys(state0.selection).filter((k) => sim.defaults(state0.style)[k] !== state0.selection[k]);
    const prev = ctx?.prevStyle;
    if (!changedKeys.length && !intents.includes('style') && prev && prev !== style && sim.pack(prev)) {
      // «сбрось» right after a style switch most likely means "back to how it was" — offer exactly that.
      const prevName = quoted(lang, styleName(lang, sim.pack(prev)));
      replyParts.push(p.resetBack(quoted(lang, styleName(lang, sim.pack(style))), prevName));
      offers.push({ label: p.resetBackChip(prevName), undo: true });
    } else replyParts.push(changedKeys.length || intents.includes('style') ? p.reset(quoted(lang, styleName(lang, sim.pack(res.state.style)))) : p.resetSame);
  }
  if (budgetInfo?.plan) {
    // Same words as the server: «Комната под 25 000 AED: «Удобно жить», итог 24 993 AED».
    const lvl = budgetInfo.level ? (lang === 'en' ? budgetInfo.level.nameEn || budgetInfo.level.name : budgetInfo.level.name)
      : (budgetInfo.index > 0 ? p.budgetBasicsLevel : p.budgetMinLevel);
    replyParts.push(budgetInfo.ok ? p.budgetPlan(aed(lang, budgetInfo.target), lvl, aed(lang, total1)) : p.budgetMin(aed(lang, budgetInfo.min)));
  } else if (budgetInfo) {
    const t = aed(lang, budgetInfo.total);
    replyParts.push(budgetInfo.already ? p.budgetAlready(t) : budgetInfo.ok ? p.budgetOk(budgetInfo.swaps, t) : p.budgetMin(aed(lang, budgetInfo.min)));
  }
  if (picked.length === 1 && nSel === 1 && !budgetInfo) {
    const pk = picked[0];
    const name = labelled(lang, pk.key, sim.typeOfKey(style, pk.key), pk.item);
    const from = sim.items.get(state0.selection[pk.key] || selection[pk.key]);
    const saving = ((+from?.price || 0) - pk.item.price) * sim.qty(style, pk.key);
    // Mention a price change the visitor did not ask about (never hide a cost).
    const priceNote = pk.mod !== 'cheaper' && saving !== 0 ? (lang === 'en' ? ` ${fmtDelta(lang, -saving)}.` : ` ${fmtDelta(lang, -saving)}.`) : '';
    const ph = pk.mod === 'cheaper' ? p.cheaper(name, aed(lang, saving))
      : pk.mod === 'color' ? p.color(name, itemColor(lang, pk.item))
      : pk.mod === 'material' ? p.material(name)
      : pk.mod === 'cozy' ? null
      : (p[pk.mod] || p.another)(name);
    if (pk.mod === 'cozy') replyParts.push(p.cozyPlus);
    else replyParts.push(priceNote ? `${ph.replace(/\.$/, ',')}${priceNote.replace(/^ /, ' ')}` : ph);
  } else if (picked.length > 1 || (nSel > 1 && !budgetInfo && !intents.includes('cheaper') && !intents.includes('style') && !intents.includes('reset'))) {
    replyParts.push(p.many(nSel, fmtDelta(lang, total1 - total0)));
  }
  replyParts.push(...lines);
  const tAct = res.actions.find((a) => a.type === 'time');
  const vAct = res.actions.find((a) => a.type === 'view');
  if (intents.includes('cozy') && !picked.some((x) => x.mod === 'cozy') && tAct) replyParts.push(p.cozy);
  else if (tAct && !replyParts.length) replyParts.push(p.time[tAct.name]);
  if (vAct && !replyParts.length) replyParts.push(p.view[vAct.name]);
  else if (vAct && tAct && replyParts.length === 1 && replyParts[0] === p.time[tAct.name]) replyParts[0] = `${p.time[tAct.name]} ${p.view[vAct.name]}`;
  if (intents.includes('total')) replyParts.push(p.total(aed(lang, total1)));

  const understood = res.actions.length > 0 || replyParts.length > 0;
  // High confidence = a pure scene command that the parser consumed entirely (no swaps, nothing left over).
  const residual = h.t.replace(FILLER, ' ').replace(/[\s.,!?-]+/g, '');
  const sceneOnly = res.actions.length > 0 && res.actions.every((a) => ['view', 'time', 'focus', 'reset'].includes(a.type)) && !mods.length && !colors.length && !mats.length;
  const confidence = understood && sceneOnly && !residual ? 'high' : 'low';

  return finish({
    understood,
    confidence,
    reply: replyParts.filter(Boolean).join(' ') || (understood ? '' : p.unknown),
    actions: res.actions,
    dropped: res.dropped,
    intents,
    total: total1,
    chips: offers.length ? [...offers, ...defaultChips(lang, { total: total1, time: ctx?.time, view: ctx?.view }).filter((c) => foldText(c) !== foldText(text)).slice(0, 2)] : undefined,
    budget: budgetInfo ? { target: budgetInfo.target, total: budgetInfo.total, ok: budgetInfo.ok, min: budgetInfo.min, level: budgetInfo.level?.id || null } : undefined,
    keep: budgetInfo?.keep?.length ? budgetInfo.keep : undefined,
  });
}

export { VIEW_LABELS, num };
