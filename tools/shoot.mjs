// Villar visual QA harness.
// Serves ./site on a local port, opens a page in headless Chrome (SwiftShader WebGL),
// collects console errors and saves screenshots.
//
// Usage:
//   NODE_PATH=$(npm root -g) node tools/shoot.mjs [--page /index.html] [--out shots/name.png]
//        [--w 1440] [--h 900] [--wait 6000] [--eval "js to run before shot"] [--hash #editor]
//        [--steps steps.json]   (array of {eval, wait, out} for multi-shot sequences)
//
// The page may expose window.villar (engine API) — steps can call it, e.g.
//   {"eval":"villar.setView('living')","wait":2500,"out":"shots/living.png"}
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, [])
);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.hdr': 'application/octet-stream', '.ktx2': 'application/octet-stream', '.glb': 'model/gltf-binary',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: Number(args.w || 1440), height: Number(args.h || 900) }, deviceScaleFactor: Number(args.dpr || 1) });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

const url = `http://127.0.0.1:${port}${args.page || '/index.html'}${args.hash || ''}`;
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(Number(args.wait || 6000));

const steps = args.steps ? JSON.parse(await readFile(args.steps, 'utf8')) : [{ eval: args.eval, wait: 0, out: args.out || 'shots/shot.png' }];
for (const s of steps) {
  if (s.eval) { try { await page.evaluate(s.eval); } catch (e) { logs.push(`[eval-error] ${e.message}`); } }
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.out) {
    await mkdir(dirname(s.out), { recursive: true });
    await page.screenshot({ path: s.out, fullPage: !!s.fullPage });
    console.log('saved', s.out);
  }
}
console.log('--- console (errors/warnings):', logs.length ? '\n' + logs.join('\n') : 'none');
await browser.close();
server.close();
