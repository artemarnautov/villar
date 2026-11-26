// Server-only deny list (not served: Vercel serves site/ statically; `_`-prefixed api files are not functions).
// Retailers / marketplaces the assistant must never name. Registered into sanitizeText by api/assistant.js.
export const SUPPLIERS = /\b(home\s*cent(?:re|er)s?|homecentre|landmark\s*group|dragon\s*mart|ikea|pan\s*emirates|danube\s*home|marina\s*home|home\s*box|homebox|2xl|west\s*elm|pottery\s*barn|zara\s*home|h\s*&\s*m\s*home|crate\s*(?:&|and)\s*barrel|amazon|noon\.com)\b/i;
export const SUPPLIERS_RU = /(?<!\p{L})(хоум\s*центр\p{L}*|икеа|икея|драгон\s*март\p{L}*)(?!\p{L})/iu;
