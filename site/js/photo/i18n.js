// Live → Photo strings, RU / EN — the same pattern as site/js/ui/i18n.js (its language, its listeners). Owner: photo.
import { getLang, onLang } from '../ui/i18n.js';

const RU = {
  'label': 'Фото · ИИ-визуализация',
  'label.aria': 'Фото, ИИ-визуализация текущего вида. Любое действие вернёт живое 3D.',
};
const EN = {
  'label': 'Photo · AI visualisation',
  'label.aria': 'Photo, an AI visualisation of this view. Any action returns to live 3D.',
};

export const tp = (key) => (getLang() === 'en' ? EN : RU)[key] ?? RU[key] ?? key;
export { onLang };
