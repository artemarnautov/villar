// RU / EN interface language. Owner: interface.
// Default comes from the browser (any Russian locale → ru, otherwise en); the choice is remembered.
// Data fields: item.nameEn / materialsEn / colorEn, pack.nameEn / taglineEn / descriptionEn, swatch.nameEn —
// each falls back to the Russian original when missing.

const KEY = 'villar:lang';
const NB = ' ';

const RU = {
  'skip': 'Перейти к квартире в 3D',
  'nav.label': 'Основная навигация', 'nav.home': 'Villar — на главную',
  'nav.apartment': 'Квартира', 'nav.style': 'Стиль', 'nav.how': 'Как это работает', 'nav.order': 'Заказать',
  'lang.toggle': 'EN', 'lang.aria': 'Switch to English',
  'hero.eyebrow': 'Villar — ИИ-студия интерьера',
  'hero.title1': `Квартира, готовая к${NB}жизни.`, 'hero.title2': `За${NB}один день.`,
  'hero.sub': `Выберите стиль — мы обставим квартиру настоящей мебелью, покажем её${NB}в${NB}3D и${NB}привезём всё в${NB}один клик, вместе со${NB}сборкой.`,
  'hero.cta': `Смотреть в${NB}3D`, 'hero.how': 'Как это работает',
  'hero.note': `Обстановка этой квартиры целиком${NB}— {total}. Мебель, свет, текстиль и${NB}декор.`,
  'studio.title': 'Квартира в 3D',
  'stage.aria': 'Квартира в 3D. Перетаскивайте, чтобы осмотреться; выбирайте предметы, чтобы заменить их.',
  'poster.alt': 'Студия: светлый диван, коньячное кресло, кровать у окна и ореховая ТВ-тумба',
  'picker.label': 'Стиль', 'picker.aria': 'Стиль квартиры', 'picker.soon': 'Новые стили скоро',
  'load.label': 'Собираем квартиру', 'load.aria': 'Загрузка 3D-сцены',
  'load.start': 'Готовим сцену', 'load.scene': 'Строим стены', 'load.textures': 'Расставляем мебель',
  'load.lighting': 'Настраиваем свет', 'load.ready': 'Почти готово',
  'stage.views': 'Ракурс', 'stage.times': 'Время суток', 'stage.plan': 'План',
  'stage.timeAria': 'Время суток: {t}. Нажмите, чтобы сменить',
  'view.eye': 'Вход', 'view.living': 'Гостиная', 'view.bed': 'Спальня', 'view.dining': 'Столовая', 'view.window': 'У окна', 'view.top': 'План',
  'vshort.eye': 'Вход', 'vshort.living': 'Диван', 'vshort.bed': 'Кровать', 'vshort.dining': 'Стол', 'vshort.window': 'Окно', 'vshort.top': 'План',
  'time.morning': 'Утро', 'time.day': 'День', 'time.golden': 'Закат', 'time.evening': 'Вечер',
  'photo': 'Фото', 'photo.title': 'Фотореалистичный кадр', 'photo.aria': 'Фото: фотореалистичный кадр текущего вида',
  'photo.stopAria': 'Остановить фоторежим', 'photo.rendering': 'Рендер', 'photo.done': 'Готово',
  'photo.note': 'Фотореалистичный кадр · любое действие отменит', 'photo.noteDone': 'Кадр готов · любое действие вернёт в 3D',
  'photo.live': 'Фоторежим: идёт фотореалистичный рендер. Любое действие отменит.', 'photo.liveDone': 'Фото готово.',
  'hint.mouse': 'Перетащите, чтобы осмотреться · Нажмите на предмет',
  'hint.touch': 'Проведите — осмотреться · Коснитесь предмета',
  'hint.planMouse': 'Наведите курсор на предмет · Нажмите, чтобы заменить',
  'hint.planTouch': 'Коснитесь предмета, чтобы заменить',
  'retry': 'Попробовать 3D снова', 'back': 'Назад',
  'hud.inStyle': 'В этом стиле', 'hud.otherStyles': 'Из других стилей', 'hud.otherSoon': 'Другие стили появятся совсем скоро',
  'hud.selected': 'Выбрано', 'hud.same': 'Та же цена', 'hud.each': 'за шт.', 'hud.pcs': '{n}{nb}шт.',
  'hud.size': 'Размер', 'hud.materials': 'Материалы', 'hud.contents': 'Состав', 'hud.color': 'Цвет',
  'hud.consequence': 'Комната перейдёт в стиль {style}: {verb} {n}{nb}{items}. Новый итог{nb}— {total} ({delta}).',
  'hud.consequenceSame': 'Комната перейдёт в стиль {style}: {verb} {n}{nb}{items}. Итог не изменится{nb}— {total}.',
  'hud.verb1': 'поменяется', 'hud.verbN': 'поменяются',
  'hud.cancel': 'Отмена', 'hud.switch': 'Перейти в стиль {style}',
  'hud.more': 'Ещё {n}', 'hud.less': 'Свернуть', 'hud.details': 'Подробнее', 'hud.total': 'Итого',
  'toast.style': 'Стиль {style}', 'toast.undo': 'Вернуть', 'toast.undone': 'Возвращён стиль {style}',
  // Budget slider (docs/BUDGET.md)
  'bs.label': 'Бюджет', 'bs.min': 'Минимум', 'bs.valuetext': '{total}, {level}, {n}{nb}{items}',
  'bs.add': '+{nb}{name}', 'bs.remove': '−{nb}{name}', 'bs.up': '{name} лучше', 'bs.down': '{name} проще',
  'bs.floor': 'Ниже не опустить: здесь ваши вещи', 'bs.announce': 'Бюджет: {level}, {total}',
  'toast.budget': 'Бюджет: {level}, {total}', 'toast.budgetUndone': 'Вернули прежний состав',
  'budget.out': 'Не входит в бюджет', 'budget.add': 'Добавить', 'budget.addAria': 'Добавить в комнату: {name}',
  'budget.pinned': 'Ваш выбор — бюджет его не меняет', 'budget.unpin': 'Открепить', 'budget.unpinAria': 'Открепить: {name}',
  'budget.added': 'Добавлено: {name}', 'budget.unpinned': 'Откреплено: {name}',
  'hud.pinned': 'Ваш выбор · бюджет не меняет', 'hud.unpin': 'Открепить',
  'switching': 'Меняем стиль…', 'stage.canvas': '3D-вид квартиры',
  'hud.only': 'Единственный вариант в этом стиле — он подобран под размеры и палитру квартиры.',
  'hud.setNote': `Меняются сразу {n}${NB}шт.`,
  'fact.fact': '{fact}', 'fact.cheapest': 'Самый доступный вариант в стиле {style}.',
  'fact.save': 'В этом стиле можно сэкономить до {sum}.', 'fact.share': '{pct}% бюджета квартиры.',
  'budget.label': 'Итого за квартиру', 'budget.aria': 'Бюджет квартиры',
  'budget.meta': '{n}{nb}{items} · стиль {style}', 'budget.show': 'Показать состав', 'budget.hide': 'Скрыть состав',
  'budget.reset': 'Сбросить к подборке стиля', 'budget.order': 'Заказать комплект',
  'budget.foot': 'Нажмите на строку, чтобы выбрать замену. Что вы выбрали сами, бюджет не меняет.', 'budget.lineAria': '{name}, {sum}. Выбрать замену',
  'budget.announce': 'Итого {total}, {sign} {delta}', 'budget.plus': 'плюс', 'budget.minus': 'минус',
  'budget.resetDone': 'Восстановлена подборка стиля', 'cart.total': 'Итого', 'cart.order': 'Заказать',
  'zone.living': 'Гостиная', 'zone.bed': 'Спальня', 'zone.dining': 'Столовая', 'zone.window': 'Окно и зелень', 'zone.entry': 'Прихожая',
  'order.eyebrow': 'Заявка', 'order.title': 'Заказать комплект',
  'order.desc': `Оставьте контакты${NB}— мы свяжемся, чтобы уточнить доставку и${NB}сборку. Оплата не${NB}нужна.`,
  'order.summary': 'Стиль {style} · {n}{nb}{items}', 'order.styleLine': 'Стиль {style}', 'order.count': '{n}{nb}{items}', 'order.showList': 'Посмотреть состав', 'order.hideList': 'Скрыть состав',
  'order.totalNote': 'Итог по текущей сборке комнаты',
  'lead.name': 'Имя', 'lead.phone': 'Телефон', 'lead.phoneHint': '+971 …', 'lead.email': 'E-mail', 'lead.optional': 'необязательно',
  'lead.contact': 'Как удобнее связаться', 'lead.whatsapp': 'WhatsApp', 'lead.call': 'Звонок', 'lead.byEmail': 'E-mail',
  'lead.comment': 'Комментарий', 'lead.commentHint': 'Например, удобная дата доставки или район',
  'lead.consent': 'Разрешаю Villar связаться со мной по этой заявке',
  'lead.send': 'Отправить заявку', 'lead.sending': 'Отправляем…',
  'lead.err.name': 'Укажите имя', 'lead.err.phoneEmpty': 'Укажите телефон', 'lead.err.phone': 'Проверьте номер', 'lead.err.email': 'Проверьте адрес',
  'lead.err.emailNeeded': 'Укажите e-mail для связи', 'lead.err.consent': 'Нужно ваше согласие',
  'lead.err.room': 'Комплект пуст — добавьте предметы и попробуйте снова.',
  'lead.err.rate': 'Слишком много заявок подряд. Попробуйте через несколько минут.',
  'lead.err.fail': 'Не получилось отправить. Попробуйте ещё раз через минуту.',
  'lead.okTitle': 'Заявка принята',
  'lead.okText': `Мы свяжемся с вами в${NB}течение рабочего дня, чтобы уточнить доставку и${NB}сборку.`,
  'lead.okRef': 'Номер заявки: {id}', 'lead.okTotal': 'Итог по заявке: {total}',
  'order.done': 'Готово', 'close': 'Закрыть',
  'style.eyebrow': 'Стиль', 'style.palette': 'Палитра', 'style.ratio': 'Как распределены цвета', 'style.rules': 'Правила стиля',
  'style.ratioAria': 'Как распределены цвета палитры', 'style.swatchesAria': 'Цвета палитры',
  'tier.base': 'База', 'tier.secondary': 'Второй план', 'tier.accent': 'Акценты',
  'how.eyebrow': 'Как это работает', 'how.title': 'Три шага до готовой квартиры.',
  'how.s1': 'Шаг 1', 'how.s1t': 'Выберите стиль',
  'how.s1b': `Стилевой пакет${NB}— это палитра, материалы и${NB}правила сочетаний, собранные дизайнерами.`,
  'how.s2': 'Шаг 2', 'how.s2t': `Осмотрите в${NB}3D, замените что${NB}угодно`,
  'how.s2b': `Пройдитесь по${NB}квартире, узнайте цену и${NB}размеры любого предмета. Замены${NB}— только из${NB}вариантов, которые подходят стилю.`,
  'how.s3': 'Шаг 3', 'how.s3t': `Закажите всё в${NB}один клик`,
  'how.s3b': `Привезём мебель, текстиль и${NB}декор${NB}— и${NB}соберём всё за${NB}один день. Останется только въехать.`,
  'how.cta': `Смотреть квартиру в${NB}3D`,
  'footer': `© Villar 2026. Цены указаны в${NB}AED. Визуализация может немного отличаться от${NB}реальных изделий.`,
  'dims.whd': 'Ш × Г × В', 'dims.dh': 'Ø × В', 'unit.cm': 'см',
  'plan.aria': 'План квартиры. Выберите предмет, чтобы увидеть детали и варианты замены.',
  'plan.bath': 'Ванная', 'plan.kitchen': 'Кухня', 'plan.entry': 'Прихожая',
  'assistant.placeholder': 'Спросите или попросите что угодно',
  'item': 'Предмет', 'style': 'Стиль',
};

const EN = {
  'skip': 'Skip to the apartment in 3D',
  'nav.label': 'Main navigation', 'nav.home': 'Villar — home',
  'nav.apartment': 'Apartment', 'nav.style': 'Style', 'nav.how': 'How it works', 'nav.order': 'Order',
  'lang.toggle': 'RU', 'lang.aria': 'Переключить на русский',
  'hero.eyebrow': 'Villar — AI interior studio',
  'hero.title1': 'A home ready to live in.', 'hero.title2': `In${NB}one day.`,
  'hero.sub': 'Pick a style — we furnish the apartment with real furniture, show it to you in 3D and deliver everything in one click, assembled.',
  'hero.cta': `View in${NB}3D`, 'hero.how': 'How it works',
  'hero.note': `Everything in this apartment${NB}— {total}. Furniture, lighting, textiles and${NB}decor.`,
  'studio.title': 'The apartment in 3D',
  'stage.aria': 'The apartment in 3D. Drag to look around; select items to replace them.',
  'poster.alt': 'Studio apartment: light sofa, cognac armchair, bed by the window and a walnut TV unit',
  'picker.label': 'Style', 'picker.aria': 'Apartment style', 'picker.soon': 'More styles soon',
  'load.label': 'Setting up the apartment', 'load.aria': 'Loading the 3D scene',
  'load.start': 'Preparing the scene', 'load.scene': 'Building the walls', 'load.textures': 'Placing the furniture',
  'load.lighting': 'Setting up the light', 'load.ready': 'Almost ready',
  'stage.views': 'View', 'stage.times': 'Time of day', 'stage.plan': 'Plan',
  'stage.timeAria': 'Time of day: {t}. Tap to change',
  'view.eye': 'Entry', 'view.living': 'Living', 'view.bed': 'Bedroom', 'view.dining': 'Dining', 'view.window': 'Window', 'view.top': 'Plan',
  'vshort.eye': 'Entry', 'vshort.living': 'Sofa', 'vshort.bed': 'Bed', 'vshort.dining': 'Table', 'vshort.window': 'Window', 'vshort.top': 'Plan',
  'time.morning': 'Morning', 'time.day': 'Day', 'time.golden': 'Sunset', 'time.evening': 'Evening',
  'photo': 'Photo', 'photo.title': 'Photoreal shot', 'photo.aria': 'Photo: photoreal shot of the current view',
  'photo.stopAria': 'Stop photo mode', 'photo.rendering': 'Rendering', 'photo.done': 'Done',
  'photo.note': 'Photoreal shot · any action cancels', 'photo.noteDone': 'Shot ready · any action returns to 3D',
  'photo.live': 'Photo mode: rendering a photoreal shot. Any action cancels.', 'photo.liveDone': 'Photo ready.',
  'hint.mouse': 'Drag to look around · Click an item',
  'hint.touch': 'Swipe to look around · Tap an item',
  'hint.planMouse': 'Point at an item · Click to replace it',
  'hint.planTouch': 'Tap an item to replace it',
  'retry': 'Try 3D again', 'back': 'Back',
  'hud.inStyle': 'In this style', 'hud.otherStyles': 'From other styles', 'hud.otherSoon': 'More styles are coming very soon',
  'hud.selected': 'Selected', 'hud.same': 'Same price', 'hud.each': 'each', 'hud.pcs': '{n}{nb}pcs',
  'hud.size': 'Size', 'hud.materials': 'Materials', 'hud.contents': 'What’s included', 'hud.color': 'Colour',
  'hud.consequence': 'The room switches to {style}: {n}{nb}{items} {verb}. New total {total} ({delta}).',
  'hud.consequenceSame': 'The room switches to {style}: {n}{nb}{items} {verb}. The total stays at {total}.',
  'hud.verb1': 'changes', 'hud.verbN': 'change',
  'hud.cancel': 'Cancel', 'hud.switch': 'Switch to {style}',
  'hud.more': '{n} more', 'hud.less': 'Show less', 'hud.details': 'Details', 'hud.total': 'Total',
  'toast.style': '{style} style', 'toast.undo': 'Undo', 'toast.undone': 'Back to {style}',
  'bs.label': 'Budget', 'bs.min': 'Minimum', 'bs.valuetext': '{total}, {level}, {n}{nb}{items}',
  'bs.add': '+{nb}{name}', 'bs.remove': '−{nb}{name}', 'bs.up': 'Better {name}', 'bs.down': 'Simpler {name}',
  'bs.floor': 'Can’t go lower: your own picks are here', 'bs.announce': 'Budget: {level}, {total}',
  'toast.budget': 'Budget: {level}, {total}', 'toast.budgetUndone': 'Previous room restored',
  'budget.out': 'Not in this budget', 'budget.add': 'Add', 'budget.addAria': 'Add to the room: {name}',
  'budget.pinned': 'Your pick — the budget keeps it', 'budget.unpin': 'Unpin', 'budget.unpinAria': 'Unpin {name}',
  'budget.added': 'Added: {name}', 'budget.unpinned': 'Unpinned: {name}',
  'hud.pinned': 'Your pick · the budget keeps it', 'hud.unpin': 'Unpin',
  'switching': 'Switching style…', 'stage.canvas': '3D view of the apartment',
  'hud.only': 'The only option in this style — chosen to fit the room’s sizes and palette.',
  'hud.setNote': `Changes all {n}${NB}pieces at once.`,
  'fact.fact': '{fact}', 'fact.cheapest': 'The most affordable option in {style}.',
  'fact.save': 'You can save up to {sum} in this style.', 'fact.share': '{pct}% of the apartment budget.',
  'budget.label': 'Apartment total', 'budget.aria': 'Apartment budget',
  'budget.meta': '{n}{nb}{items} · {style} style', 'budget.show': 'Show items', 'budget.hide': 'Hide items',
  'budget.reset': 'Reset to the style’s picks', 'budget.order': 'Order the set',
  'budget.foot': 'Tap a line to pick a replacement. Whatever you pick yourself, the budget keeps.', 'budget.lineAria': '{name}, {sum}. Pick a replacement',
  'budget.announce': 'Total {total}, {sign} {delta}', 'budget.plus': 'plus', 'budget.minus': 'minus',
  'budget.resetDone': 'Style picks restored', 'cart.total': 'Total', 'cart.order': 'Order',
  'zone.living': 'Living', 'zone.bed': 'Bedroom', 'zone.dining': 'Dining', 'zone.window': 'Window & greenery', 'zone.entry': 'Entry',
  'order.eyebrow': 'Request', 'order.title': 'Order the set',
  'order.desc': `Leave your contact${NB}— we’ll get in touch to arrange delivery and assembly. No payment needed.`,
  'order.summary': '{style} style · {n}{nb}{items}', 'order.styleLine': '{style} style', 'order.count': '{n}{nb}{items}', 'order.showList': 'View items', 'order.hideList': 'Hide items',
  'order.totalNote': 'Total for the room as assembled',
  'lead.name': 'Name', 'lead.phone': 'Phone', 'lead.phoneHint': '+971 …', 'lead.email': 'Email', 'lead.optional': 'optional',
  'lead.contact': 'Preferred contact', 'lead.whatsapp': 'WhatsApp', 'lead.call': 'Call', 'lead.byEmail': 'Email',
  'lead.comment': 'Comment', 'lead.commentHint': 'For example, a delivery date or your area',
  'lead.consent': 'Villar may contact me about this request',
  'lead.send': 'Send request', 'lead.sending': 'Sending…',
  'lead.err.name': 'Enter your name', 'lead.err.phoneEmpty': 'Enter your phone number', 'lead.err.phone': 'Check the number', 'lead.err.email': 'Check the address',
  'lead.err.emailNeeded': 'Add an email to be contacted by', 'lead.err.consent': 'Your consent is needed',
  'lead.err.room': 'The set is empty — add items and try again.',
  'lead.err.rate': 'Too many requests in a row. Please try again in a few minutes.',
  'lead.err.fail': 'Couldn’t send it. Please try again in a minute.',
  'lead.okTitle': 'Request received',
  'lead.okText': 'We’ll contact you within one working day to arrange delivery and assembly.',
  'lead.okRef': 'Request number: {id}', 'lead.okTotal': 'Total for the request: {total}',
  'order.done': 'Done', 'close': 'Close',
  'style.eyebrow': 'Style', 'style.palette': 'Palette', 'style.ratio': 'How the colours are used', 'style.rules': 'Style rules',
  'style.ratioAria': 'How the palette colours are used', 'style.swatchesAria': 'Palette colours',
  'tier.base': 'Base', 'tier.secondary': 'Secondary', 'tier.accent': 'Accents',
  'how.eyebrow': 'How it works', 'how.title': 'Three steps to a finished home.',
  'how.s1': 'Step 1', 'how.s1t': 'Pick a style',
  'how.s1b': 'A style pack is a palette, materials and pairing rules put together by designers.',
  'how.s2': 'Step 2', 'how.s2t': `Explore in${NB}3D, replace anything`,
  'how.s2b': 'Walk through the apartment and see the price and size of every item. Replacements come only from options that fit the style.',
  'how.s3': 'Step 3', 'how.s3t': `Order it all in${NB}one click`,
  'how.s3b': `We deliver the furniture, textiles and decor${NB}— and assemble everything in one day. All that’s left is to move in.`,
  'how.cta': `View the apartment in${NB}3D`,
  'footer': `© Villar 2026. Prices in${NB}AED. Renders may differ slightly from the actual products.`,
  'dims.whd': 'W × D × H', 'dims.dh': 'Ø × H', 'unit.cm': 'cm',
  'plan.aria': 'Apartment plan. Select an item to see details and replacements.',
  'plan.bath': 'Bathroom', 'plan.kitchen': 'Kitchen', 'plan.entry': 'Entry',
  'assistant.placeholder': 'Ask or request anything',
  'item': 'Item', 'style': 'Style',
};

const DICT = { ru: RU, en: EN };
const listeners = new Set();

function detect() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'ru' || q === 'en') return q;
    const saved = localStorage.getItem(KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch { /* storage unavailable */ }
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language || 'ru'];
  return langs.some((l) => /^ru\b|^ru-/i.test(l)) ? 'ru' : 'en';
}

let lang = detect();
document.documentElement.lang = lang;

export const getLang = () => lang;
export const isEn = () => lang === 'en';
export const locale = () => (lang === 'en' ? 'en-US' : 'ru-RU');

/** t('hud.switch', { style: '«X»' }) — falls back to Russian, then to the key. */
export function t(key, vars) {
  let s = DICT[lang][key] ?? RU[key] ?? key;
  if (vars || s.includes('{nb}')) s = s.replace(/\{(\w+)\}/g, (m, k) => (k === 'nb' ? NB : vars && vars[k] != null ? String(vars[k]) : m));
  return s;
}

/** Pick the language variant of a data field: L(item.name, item.nameEn). */
export const L = (ru, en) => (lang === 'en' && en != null && en !== '' && !(Array.isArray(en) && !en.length) ? en : ru);

/** Plural of "item": n предмет/предмета/предметов · n item/items. */
export function itemsWord(n) {
  if (lang === 'en') return n === 1 ? 'item' : 'items';
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return 'предметов';
  if (b > 1 && b < 5) return 'предмета';
  if (b === 1) return 'предмет';
  return 'предметов';
}
export function optionsWord(n) {
  if (lang === 'en') return n === 1 ? 'option' : 'options';
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return 'вариантов';
  if (b > 1 && b < 5) return 'варианта';
  if (b === 1) return 'вариант';
  return 'вариантов';
}

/** Translate static markup: [data-i18n] (text) and [data-i18n-attr="aria-label:key;alt:key"]. */
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    }
  });
  document.title = lang === 'en' ? 'Villar — a home ready to live in. In one day.' : 'Villar — квартира, готовая к жизни. За один день.';
}

export function setLang(next) {
  if (next !== 'ru' && next !== 'en') return;
  if (next === lang) return;
  lang = next;
  document.documentElement.lang = lang;
  try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
  applyStatic();
  for (const fn of listeners) { try { fn(lang); } catch (e) { console.error('[i18n] listener failed', e); } }
}

export function onLang(fn) { listeners.add(fn); return () => listeners.delete(fn); }
