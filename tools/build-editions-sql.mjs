// Villar Editions → generation jobs. Owner: curator. Reads tools/editions.json, writes tools/editions-jobs.sql:
// one `insert into photo_jobs (kind, params)` per work (2 candidates, 2K). The photo engineer owns the table.
//   node tools/build-editions-sql.mjs           write the SQL
//   node tools/build-editions-sql.mjs --check   exit 1 if the SQL is stale
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const { works } = JSON.parse(readFileSync(resolve(DIR, 'editions.json'), 'utf8'));
const row = (w) => {
  const params = { id: w.id, style: w.style, prompt: w.prompt, palette: w.palette, aspect: w.aspect, candidates: 2, resolution: '2K' }; // '2K' is the spelling the job accepts (api/photo.js)
  if (w.prompt.length > 800) throw new Error(`${w.id}: the job trims the brief to 800 characters (${w.prompt.length})`);
  const json = JSON.stringify(params);
  if (json.includes('$job$')) throw new Error(`${w.id}: prompt contains the dollar-quote tag`);
  return `insert into photo_jobs (kind, params) values ('edition', $job$${json}$job$::jsonb);`;
};
const sql = [
  '-- Villar Editions: 24 works × 2 candidates (docs/ART.md §1 and §5).',
  '-- GENERATED from tools/editions.json by tools/build-editions-sql.mjs: edit the JSON, not this file.',
  '-- params: id, style, prompt, palette, aspect, candidates, resolution. The approved candidate is stored at art/<id>.jpg.',
  'begin;',
  ...works.map(row),
  'commit;',
  '',
].join('\n');
const out = resolve(DIR, 'editions-jobs.sql');
if (process.argv.includes('--check')) {
  if (!existsSync(out) || readFileSync(out, 'utf8') !== sql) { console.error('tools/editions-jobs.sql is stale. Run: node tools/build-editions-sql.mjs'); process.exit(1); }
  console.log(`editions-jobs.sql up to date (${works.length} jobs)`);
} else { writeFileSync(out, sql); console.log(`wrote tools/editions-jobs.sql — ${works.length} jobs`); }
