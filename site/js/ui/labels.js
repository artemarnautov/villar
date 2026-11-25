// Russian UI vocabulary. Owner: interface.

export const TYPE_LABELS = {
  sofa: 'Диван',
  armchair: 'Кресло',
  coffee_table: 'Журнальный столик',
  side_table: 'Приставной столик',
  tv_unit: 'ТВ-тумба',
  bed: 'Кровать',
  mattress: 'Матрас',
  bedding: 'Постельное бельё',
  nightstand: 'Прикроватная тумба',
  dining_table: 'Обеденный стол',
  dining_chair: 'Обеденный стул',
  floor_lamp: 'Торшер',
  table_lamp: 'Настольная лампа',
  pendant_lamp: 'Подвесной светильник',
  rug: 'Ковёр',
  curtains: 'Шторы',
  wall_art: 'Картина',
  plant: 'Растение',
  decor_set: 'Декор',
  cushions: 'Подушки',
  mirror: 'Зеркало',
  desk: 'Письменный стол',
  shelf: 'Стеллаж',
  bench: 'Скамья',
  stool: 'Табурет',
  pouf: 'Пуф',
  throw: 'Плед',
};
export const typeLabel = (t) => TYPE_LABELS[t] || 'Предмет';

/** Palette roles → Russian. */
export const ROLE_LABELS = {
  walls: 'Стены', wall: 'Стены', base: 'База', background: 'Фон', floor: 'Пол', ceiling: 'Потолок',
  textiles: 'Текстиль', textile: 'Текстиль', upholstery: 'Обивка', fabric: 'Ткань',
  wood: 'Дерево', secondary: 'Второй план', furniture: 'Мебель',
  accent: 'Акцент', accents: 'Акцент', metal: 'Металл', stone: 'Камень', greenery: 'Зелень', plant: 'Зелень',
  neutral: 'Нейтральный', highlight: 'Акцент', kitchen: 'Кухня',
};
export const roleLabel = (r) => ROLE_LABELS[String(r || '').toLowerCase()] || 'Оттенок';

/** Which tier of the 60/30/10 rule a role belongs to. */
const TIER_OF = {
  walls: 'base', wall: 'base', base: 'base', background: 'base', floor: 'base', ceiling: 'base', neutral: 'base',
  textiles: 'secondary', textile: 'secondary', upholstery: 'secondary', fabric: 'secondary',
  wood: 'secondary', secondary: 'secondary', furniture: 'secondary', kitchen: 'secondary',
  stone: 'accent', accent: 'accent', accents: 'accent', metal: 'accent', highlight: 'accent', greenery: 'accent', plant: 'accent',
};
export const tierOf = (role) => TIER_OF[String(role || '').toLowerCase()] || 'secondary';
export const TIERS = [
  { id: 'base', label: 'База' },
  { id: 'secondary', label: 'Второй план' },
  { id: 'accent', label: 'Акценты' },
];

export const VIEWS = [
  { value: 'eye', label: 'Вход' },
  { value: 'living', label: 'Гостиная' },
  { value: 'bed', label: 'Спальня' },
  { value: 'dining', label: 'Обед' },
  { value: 'window', label: 'У окна' },
  { value: 'top', label: 'План' },
];

export const TIMES = [
  { value: 'morning', label: 'Утро' },
  { value: 'day', label: 'День' },
  { value: 'golden', label: 'Закат' },
  { value: 'evening', label: 'Вечер' },
];

export const ITEM_FORMS = ['предмет', 'предмета', 'предметов'];
export const LINE_FORMS = ['позиция', 'позиции', 'позиций'];
export const OPTION_FORMS = ['вариант', 'варианта', 'вариантов'];
