// Public media the UI shows by URL. Owner: interface.
// Villar Editions artwork (docs/ART.md §5): catalogue items carry `image: "art/<id>.jpg"`, a key in the Villar
// Supabase Storage bucket `photos` (public read). The origin is the one tools/csp.mjs allows in img-src
// (PHOTO_ORIGIN). Change the base here only.
export const MEDIA_BASE = 'https://hdhwkvbecuzzrugogutd.supabase.co/storage/v1/object/public/photos/';

// [engine, eng-2] Approved artwork: site/data/art.json `{ "approved": ["art/<id>.jpg", …] }` lists the keys whose
// file exists in Storage (the coordinator adds a key after reviewing the image). Nothing is requested for any
// other art key, in the card or in the 3D room: no 404s. `artApproved` resolves to the Set of keys.
let approvedArt = null;
export const artApproved = (typeof fetch === 'function' ? fetch('/data/art.json').then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null))
  .then((j) => (approvedArt = new Set(Array.isArray(j?.approved) ? j.approved : [])));

/**
 * URL of a public media key ('art/x.jpg'); null for anything that is not a plain relative key, and for an
 * artwork key that is not (yet known to be) approved.
 */
export function mediaUrl(key) {
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9/_.-]{0,160}$/i.test(key) || key.includes('..')) return null;
  if (key.startsWith('art/') && !(approvedArt && approvedArt.has(key))) return null;
  return MEDIA_BASE + key;
}
