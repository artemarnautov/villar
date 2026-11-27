// Public media the UI shows by URL. Owner: interface.
// Villar Editions artwork (docs/ART.md §5): catalogue items carry `image: "art/<id>.jpg"`, a key in the Villar
// Supabase Storage bucket `photos` (public read). The origin is the one tools/csp.mjs allows in img-src
// (PHOTO_ORIGIN). Change the base here only.
export const MEDIA_BASE = 'https://hdhwkvbecuzzrugogutd.supabase.co/storage/v1/object/public/photos/';

/** URL of a public media key ('art/x.jpg'); null for anything that is not a plain relative key. */
export function mediaUrl(key) {
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9/_.-]{0,160}$/i.test(key) || key.includes('..')) return null;
  return MEDIA_BASE + key;
}
