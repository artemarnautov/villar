// Hard-rule gate: nothing served from site/ may name a supplier/retailer/brand, link to a product page or carry
// SKU/article-like codes. Run before every push: node tools/check-public.mjs  (exit 1 on any hit).
// Lives in tools/ (not served), so it may spell the names out.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const SKIP_DIRS = new Set(['vendor', 'lab']); // third-party code; /lab is redirected away in production
const EXT = /\.(html|js|mjs|css|json|txt|svg|webmanifest)$/i;

const RULES = [
  ['supplier/retailer', /home\s*cent(?:re|er)|homecentre|landmark\s*group|dragon\s*mart|\bikea\b|pan\s*emirates|danube\s*home|marina\s*home|home\s*box|\bhomebox\b|west\s*elm|pottery\s*barn|zara\s*home|crate\s*(?:&|and)\s*barrel|\bnoon\.com|amazon\.|хоум\s*центр|икеа|икея|драгон\s*март/i],
  ['marketplace brand', /\bmahmayi\b|\bhomekode\b|\bpan\s*home\b|\bhomes\s*r\s*us\b/i],
  ['paint brand / code', /\bjotun\b|farrow\s*(?:&|and)\s*ball|benjamin\s*moore|sherwin|\bpantone\b|\bdulux\b|little\s*greene|\bNCS\s*S?\s*\d{4}|\bRAL\s*\d{4}\b/i],
  ['product URL', /https?:\/\/(?!www\.w3\.org|schema\.org|villar)[^\s"'<>)]*(?:product|\/p\/|item|catalog|shop)/i],
  ['SKU / article', /"(?:sku|article|articleNo|supplierUrl|sourceUrl|url|href|brand|vendor|supplier)"\s*:/i],
];

const hits = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(p); continue; }
    if (!EXT.test(name)) continue;
    const text = readFileSync(p, 'utf8');
    text.split('\n').forEach((line, i) => {
      for (const [kind, re] of RULES) {
        const m = line.match(re);
        if (m) hits.push(`${relative(ROOT, p)}:${i + 1}  [${kind}]  …${line.slice(Math.max(0, m.index - 30), m.index + 50).trim()}…`);
      }
    });
  }
})(SITE);

if (hits.length) {
  console.log(`check-public: ${hits.length} hit(s)\n` + hits.join('\n'));
  process.exit(1);
}
console.log('check-public: clean (site/, excluding vendor/ and lab/)');
