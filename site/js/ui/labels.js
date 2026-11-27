// UI vocabulary (RU / EN): categories, palette roles, views, times, zones. Owner: interface.
import { getLang, t, L } from './i18n.js';
import { normName, shortEnName } from '../ai/i18n.js';

const TYPES = {
  sofa: ['Диван', 'Sofa'], armchair: ['Кресло', 'Armchair'], coffee_table: ['Журнальный столик', 'Coffee table'],
  side_table: ['Приставной столик', 'Side table'], tv_unit: ['ТВ-тумба', 'TV unit'], bed: ['Кровать', 'Bed'],
  mattress: ['Матрас', 'Mattress'], bedding: ['Постельное бельё', 'Bedding'], nightstand: ['Прикроватная тумба', 'Nightstand'],
  dining_table: ['Обеденный стол', 'Dining table'], dining_chair: ['Обеденный стул', 'Dining chair'],
  floor_lamp: ['Торшер', 'Floor lamp'], table_lamp: ['Настольная лампа', 'Table lamp'],
  pendant_lamp: ['Подвесной светильник', 'Pendant light'], rug: ['Ковёр', 'Rug'], curtains: ['Шторы', 'Curtains'],
  wall_art: ['Картина', 'Wall art'], plant: ['Растение', 'Plant'], decor_set: ['Декор', 'Decor'],
  cushions: ['Подушки', 'Cushions'], mirror: ['Зеркало', 'Mirror'], desk: ['Письменный стол', 'Desk'],
  shelf: ['Стеллаж', 'Shelving'], bench: ['Скамья', 'Bench'], stool: ['Табурет', 'Stool'], pouf: ['Пуф', 'Pouf'],
  throw: ['Плед', 'Throw'], tableware: ['Сервировка', 'Tableware'], centerpiece: ['Композиция на стол', 'Centrepiece'],
  kitchen_decor: ['Кухонные мелочи', 'Kitchen accessories'], nightstand_decor: ['Декор у кровати', 'Bedside decor'],
  runner: ['Дорожка', 'Runner'], towels: ['Полотенца', 'Towels'],
};
const li = () => (getLang() === 'en' ? 1 : 0);
export const typeLabel = (type) => TYPES[type]?.[li()] || t('item');

// ---------- Item names, display level only (D3-05): the catalog keeps its names ----------
// RU category words the eyebrow already says, stripped from the start of a name for the short form.
const RU_PREFIXES = {
  sofa: ['Диван'], armchair: ['Кресло'], coffee_table: ['Журнальный столик', 'Журнальный стол'],
  side_table: ['Приставной столик', 'Приставной стол'], tv_unit: ['ТВ-тумба', 'Тумба под ТВ'],
  bed: ['Кровать'], mattress: ['Матрас'], bedding: ['Постельное бельё', 'Постель'],
  nightstand: ['Прикроватная тумба', 'Тумба'], table_lamp: ['Настольная лампа', 'Лампа'],
  dining_table: ['Обеденный стол', 'Стол'], dining_chair: ['Обеденный стул', 'Стул'],
  floor_lamp: ['Торшер'], pendant_lamp: ['Подвесной светильник', 'Светильник'], rug: ['Ковёр', 'Ковер'],
  curtains: ['Шторы'], wall_art: ['Картина'], cushions: ['Подушки'], decor_set: ['Декор'],
  kitchen_decor: ['Кухня'], nightstand_decor: ['У кровати'], mirror: ['Зеркало'], runner: ['Дорожка'], throw: ['Плед'],
};
const capFirst = (s) => String(s).replace(/^\p{Ll}/u, (c) => c.toUpperCase());
/** Full name (budget, order list): one spelling for sofas in EN ("3-seater"). */
export const displayName = (item) => normName(L(item?.name, item?.nameEn));
/**
 * Name under a category eyebrow, without repeating it: «Диван Lansbury, трёхместный» → «Lansbury, трёхместный»,
 * "Lansbury 3-seater sofa" → "Lansbury 3-seater", "Bedding: white percale…" → "White percale…".
 */
export function displayShortName(item) {
  const sn = L(item?.shortName, item?.shortNameEn);
  if (sn) return sn;
  const name = displayName(item);
  if (getLang() === 'en') return capFirst(shortEnName(item?.type, name));
  for (const p of RU_PREFIXES[item?.type] || []) {
    if (name.toLowerCase().startsWith(p.toLowerCase())) {
      const rest = name.slice(p.length).replace(/^[\s:,—–-]+/, '');
      if (rest.length >= 2) return capFirst(rest);
    }
  }
  return name;
}

/** Slots that share a type get their own name (two decor placements, three pieces of art). */
const SLOTS = {
  decor_coffee: ['Декор на журнальном столике', 'Coffee table decor'], decor_tv: ['Декор на ТВ-тумбе', 'TV unit decor'],
  art_sofa: ['Картина над диваном', 'Art above the sofa'], art_bed: ['Картина над кроватью', 'Art above the bed'],
  art_dining: ['Картина в столовой', 'Dining art'],
};
export const slotLabel = (slotId, type) => SLOTS[slotId]?.[li()] || typeLabel(type);

/** Palette roles. */
const ROLES = {
  walls: ['Стены', 'Walls'], wall: ['Стены', 'Walls'], base: ['База', 'Base'], background: ['Фон', 'Background'],
  floor: ['Пол', 'Floor'], ceiling: ['Потолок', 'Ceiling'], textiles: ['Текстиль', 'Textiles'], textile: ['Текстиль', 'Textiles'],
  upholstery: ['Обивка', 'Upholstery'], fabric: ['Ткань', 'Fabric'], wood: ['Дерево', 'Wood'],
  secondary: ['Второй план', 'Secondary'], furniture: ['Мебель', 'Furniture'], accent: ['Акцент', 'Accent'],
  accents: ['Акцент', 'Accent'], metal: ['Металл', 'Metal'], stone: ['Камень', 'Stone'], greenery: ['Зелень', 'Greenery'],
  plant: ['Зелень', 'Greenery'], neutral: ['Нейтральный', 'Neutral'], highlight: ['Акцент', 'Accent'], kitchen: ['Кухня', 'Kitchen'],
};
export const roleLabel = (r) => ROLES[String(r || '').toLowerCase()]?.[li()] || (li() ? 'Shade' : 'Оттенок');

/** Which tier of the 60/30/10 rule a role belongs to. */
const TIER_OF = {
  walls: 'base', wall: 'base', base: 'base', background: 'base', floor: 'base', ceiling: 'base', neutral: 'base',
  textiles: 'secondary', textile: 'secondary', upholstery: 'secondary', fabric: 'secondary',
  wood: 'secondary', secondary: 'secondary', furniture: 'secondary', kitchen: 'secondary',
  stone: 'accent', accent: 'accent', accents: 'accent', metal: 'accent', highlight: 'accent', greenery: 'accent', plant: 'accent',
};
export const tierOf = (role) => TIER_OF[String(role || '').toLowerCase()] || 'secondary';
export const tiers = () => ['base', 'secondary', 'accent'].map((id) => ({ id, label: t(`tier.${id}`) }));

export const VIEW_IDS = ['eye', 'living', 'bed', 'dining', 'window', 'top'];
export const TIME_IDS = ['morning', 'day', 'golden', 'evening'];
export const views = () => VIEW_IDS.map((v) => ({ value: v, label: t(`view.${v}`) }));
export const times = () => TIME_IDS.map((v) => ({ value: v, label: t(`time.${v}`) }));

/** Budget zones, in reading order. A line's zone comes from its slot id, then its type. */
export const zones = () => ['living', 'bed', 'dining', 'window', 'entry'].map((id) => ({ id, label: t(`zone.${id}`) }));
const ZONE_OF_TYPE = {
  sofa: 'living', cushions: 'living', coffee_table: 'living', rug: 'living', tv_unit: 'living', side_table: 'living',
  armchair: 'living', floor_lamp: 'living', throw: 'living',
  bed: 'bed', mattress: 'bed', bedding: 'bed', nightstand: 'bed', table_lamp: 'bed', nightstand_decor: 'bed',
  dining_table: 'dining', dining_chair: 'dining', pendant_lamp: 'dining', tableware: 'dining', centerpiece: 'dining', kitchen_decor: 'dining',
  curtains: 'window', plant: 'window', runner: 'entry', mirror: 'entry', towels: 'entry',
};
export function zoneOf(slotId, type) {
  const id = String(slotId || '');
  if (ZONE_OF_TYPE[type] === 'entry') return 'entry';
  if (/sofa|coffee|tv|living|armchair/.test(id)) return 'living';
  if (/bed|night/.test(id)) return 'bed';
  if (/dining|pendant|chair|kitchen|table_?ware|center/.test(id)) return 'dining';
  return ZONE_OF_TYPE[type] || 'window';
}
