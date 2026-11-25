// Regenerates vercel.json security headers with a strict CSP that whitelists the exact inline
// scripts of site/index.html by SHA-256 hash. Run after any change to inline <script> blocks:
//   node tools/csp.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'site/index.html'), 'utf8');

const hashes = [];
for (const m of html.matchAll(/<script(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/script>/g)) {
  if (/\bsrc\s*=/.test(m.groups.attrs)) continue;
  const body = m.groups.body;
  if (!body.trim()) continue;
  hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
}

const csp = [
  "default-src 'self'",
  `script-src 'self' ${hashes.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const config = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  framework: null,
  buildCommand: '',
  installCommand: '',
  outputDirectory: 'site',
  cleanUrls: true,
  redirects: [
    // Dev/test pages are not part of the public product.
    { source: '/lab', destination: '/', permanent: false },
    { source: '/lab/:path*', destination: '/', permanent: false },
  ],
  headers: [
    {
      source: '/(.*)',
      headers: [
        { key: 'Content-Security-Policy', value: csp },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      ],
    },
    // Vendor paths are not versioned, so cache them for a day and revalidate instead of "immutable".
    { source: '/vendor/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }] },
    { source: '/data/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
  ],
};

writeFileSync(resolve(root, 'vercel.json'), JSON.stringify(config, null, 2) + '\n');
console.log(`vercel.json updated: ${hashes.length} inline script hash(es)`);
