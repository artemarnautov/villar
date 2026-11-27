# Villar — sky prep (engine). Usage: python3 tools/sky-prep.py <checkout of zuujis-cc0/polyhaven-hdris-pure-skies> [out dir]
# Builds site/assets/sky/{morning,day,golden,evening}.hdr from CC0 Poly Haven pure-sky HDRIs (see site/assets/materials/LICENSES.md).
import numpy as np
def read_hdr(path):
    f = open(path, 'rb'); data = f.read(); f.close()
    i = data.index(b'\n\n') + 2
    j = data.index(b'\n', i)
    dims = data[i:j].decode().split()
    H, W = int(dims[1]), int(dims[3])
    p = j + 1
    out = np.zeros((H, W, 4), np.uint8)
    buf = np.frombuffer(data, np.uint8)
    for y in range(H):
        if buf[p] == 2 and buf[p+1] == 2 and (int(buf[p+2]) << 8 | int(buf[p+3])) == W:
            p += 4
            for c in range(4):
                x = 0
                row = out[y, :, c]
                while x < W:
                    n = int(buf[p]); p += 1
                    if n > 128:
                        n -= 128; row[x:x+n] = buf[p]; p += 1
                    else:
                        row[x:x+n] = buf[p:p+n]; p += n
                    x += n
        else:
            out[y] = buf[p:p+W*4].reshape(W, 4); p += W*4
    e = out[..., 3].astype(np.int32)
    scale = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0)
    return out[..., :3].astype(np.float32) * scale[..., None]
def write_hdr(path, img):
    H, W, _ = img.shape
    m = img.max(axis=2)
    mant, ex = np.frexp(m)
    sc = np.where(m > 1e-32, mant * 256.0 / np.maximum(m, 1e-32), 0)
    rgbe = np.zeros((H, W, 4), np.uint8)
    rgbe[..., :3] = np.clip(img * sc[..., None], 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.where(m > 1e-32, ex + 128, 0).astype(np.uint8)
    with open(path, 'wb') as f:
        f.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y %d +X %d\n' % (H, W))
        f.write(rgbe.tobytes())
def preview(img, path, ev=0.0, w=None):
    from PIL import Image
    x = img * (2.0 ** ev)
    x = x / (1 + x)  # simple reinhard
    x = np.clip(x, 0, 1) ** (1/2.2)
    im = Image.fromarray((x * 255).astype(np.uint8))
    if w: im = im.resize((w, int(w * img.shape[0] / img.shape[1])))
    im.save(path)
def write_hdr_rle(path, img):
    H, W, _ = img.shape
    m = img.max(axis=2)
    mant, ex = np.frexp(m)
    sc = np.where(m > 1e-32, mant * 256.0 / np.maximum(m, 1e-32), 0)
    rgbe = np.zeros((H, W, 4), np.uint8)
    rgbe[..., :3] = np.clip(img * sc[..., None], 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.where(m > 1e-32, ex + 128, 0).astype(np.uint8)
    out = bytearray(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y %d +X %d\n' % (H, W))
    for y in range(H):
        out += bytes([2, 2, W >> 8, W & 255])
        for c in range(4):
            row = rgbe[y, :, c].tolist(); x = 0
            while x < W:
                # run?
                r = 1
                while x + r < W and r < 127 and row[x + r] == row[x]: r += 1
                if r >= 3:
                    out += bytes([128 + r, row[x]]); x += r; continue
                # literal until a run of 3 starts
                s = x; n = 0
                while x < W and n < 128:
                    if x + 2 < W and row[x] == row[x + 1] == row[x + 2]: break
                    x += 1; n += 1
                out += bytes([n]) + bytes(row[s:s + n])
    open(path, 'wb').write(out)

import sys, os
SRC_DIR = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT_DIR = sys.argv[2] if len(sys.argv) > 2 else 'site/assets/sky'
SRC = {
  'morning': f'{SRC_DIR}/qwantani_morning_puresky/qwantani_morning_puresky_1k.hdr',
  'day': f'{SRC_DIR}/qwantani_mid_morning_puresky/qwantani_mid_morning_puresky_1k.hdr',
  'golden': f'{SRC_DIR}/qwantani_sunset_puresky/qwantani_sunset_puresky_1k.hdr',
  'evening': f'{SRC_DIR}/qwantani_dusk_2_puresky/qwantani_dusk_2_puresky_1k.hdr',
}
SUNR = {'morning': 11.0, 'day': 11.0, 'golden': 3.5, 'evening': 3.0}
HOLES = {}
BAND = {'morning': 1.5, 'day': 1.5, 'golden': 1.5, 'evening': 1.5}
SUN = {'morning': (17, 40), 'day': (41, -24), 'golden': (9, -47), 'evening': (-5, -60)}
PRESET = {
  'morning': ('#6f98c8', '#d6dde3', 0.26, 0.84),
  'day': ('#5a8cc4', '#e3e6e3', 0.30, 0.9),
  'golden': ('#6283b4', '#e9d2b8', 0.22, 0.60),
  'evening': ('#132a5e', '#3b4f7a', 0.035, 0.06),
}
W_LUM = np.array([0.2126, 0.7152, 0.0722])
def lin(hexs):
    c = np.array([int(hexs[i:i+2], 16) / 255 for i in (1, 3, 5)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def proc_row(tod, y):
    z, h, zl, hl = PRESET[tod]
    zen, hor = lin(z) * zl, lin(h) * hl
    t = y ** 0.45; band = np.exp(-y * 18) * 0.35
    return hor + (zen - hor) * t + hor * band
def inpaint(img, mask):
    """Pyramid (push-pull) inpainting: smooth fills for large holes."""
    def down(a, m):
        H, W = m.shape; H2, W2 = H // 2, W // 2
        w = (~m[:H2*2, :W2*2]).astype(np.float64).reshape(H2, 2, W2, 2)
        v = a[:H2*2, :W2*2].reshape(H2, 2, W2, 2, 3)
        ws = w.sum(axis=(1, 3))
        vs = (v * w[..., None]).sum(axis=(1, 3)) / np.maximum(ws, 1e-9)[..., None]
        return vs, ws < 0.5
    levels = [(img.copy(), mask.copy())]
    while levels[-1][1].any() and min(levels[-1][1].shape) > 4:
        levels.append(down(*levels[-1]))
    a, m = levels[-1]
    if m.any(): a[m] = a[~m].mean(axis=0) if (~m).any() else 0
    for i in range(len(levels) - 2, -1, -1):
        fa, fm = levels[i]
        up = np.repeat(np.repeat(a, 2, 0), 2, 1)
        up = np.pad(up, ((0, fa.shape[0] - up.shape[0]), (0, fa.shape[1] - up.shape[1]), (0, 0)), mode='edge')
        fa = fa.copy(); fa[fm] = up[fm]
        for _ in range(4):                                 # relax the seams a little
            sm = (np.roll(fa, 1, 0) + np.roll(fa, -1, 0) + np.roll(fa, 1, 1) + np.roll(fa, -1, 1)) / 4
            fa[fm] = sm[fm]
        a = fa
    return a
def build(tod, out_hdr, out_png):
    img = read_hdr(SRC[tod]).astype(np.float64)
    H, W, _ = img.shape
    lat = 90 - (np.arange(H) + 0.5) / H * 180          # row 0 = top (+90)
    phi = (np.arange(W) + 0.5) / W * 360 - 180         # three equirect: atan2(z, x)
    L = img @ W_LUM
    # --- 1. sun: find it in the upper hemisphere, inpaint the disc + the hot core of the aureole
    up = lat > -2
    Lm = np.where(up[:, None], L, 0)
    sy, sx = np.unravel_index(np.argmax(Lm), L.shape)
    s_lat, s_phi = lat[sy], phi[sx]
    d = lambda a: np.radians(a)
    cosA = (np.sin(d(lat))[:, None] * np.sin(d(s_lat)) + np.cos(d(lat))[:, None] * np.cos(d(s_lat)) * np.cos(d(phi[None, :] - s_phi)))
    ang = np.degrees(np.arccos(np.clip(cosA, -1, 1)))
    R = SUNR[tod]
    ring = (ang > R) & (ang < R + 2)
    ring_med = np.median(L[ring])
    mask = (ang < R) & (L > ring_med * (1.1 if R > 5 else 1.2))
    for (x0, x1, y0, y1) in HOLES.get(tod, []):           # buildings poking above the horizon band
        mask[y0:y1, x0:x1] = True
    filled = inpaint(img, mask)
    img = filled
    L = img @ W_LUM
    # clamp what is left of the aureole to a sane ceiling (no fireflies, fits half float)
    ceil = np.percentile(L[lat > 0], 99.5) * 3
    k = np.minimum(1, ceil / np.maximum(L, 1e-9))
    img *= k[..., None]
    # --- 2. rotate: the HDR's sun azimuth onto the engine's sun azimuth
    alt, az = SUN[tod]
    phi_engine = 90 - az
    shift = int(round((phi_engine - s_phi) / 360 * W))
    img = np.roll(img, shift, axis=1)
    # --- 3. horizon: rebuild the band below `top` as a smooth haze gradient (no trees / buildings / water),
    #        lower hemisphere a haze → ground ramp (the 3D city covers most of it)
    top = BAND[tod]
    ref_rows = (lat > top + 0.5) & (lat < top + 3.0)
    ref = img[ref_rows].mean(axis=0)                     # per column, just above the band
    hz_rows = (lat > max(top, 2) ) & (lat < max(top, 2) + 3)
    def hblur(a, sig):
        n = a.shape[0]; x = np.arange(-3 * sig, 3 * sig + 1); w = np.exp(-x * x / (2 * sig * sig)); w /= w.sum()
        out = np.zeros_like(a)
        for i, wi in zip(x, w): out += np.roll(a, int(i), axis=0) * wi
        return out
    ref = hblur(ref, 6)
    haze = hblur(img[hz_rows].mean(axis=0), 24) * (1.06 if top > 2 else 1.0)
    gmean = haze.mean(axis=0)
    haze_low = hblur(haze, 60) * 0.5 + gmean * 0.5
    for j in range(H):
        a = lat[j]
        if a >= top: continue
        if a >= 0:
            t = (a / top) ** 1.6                        # 0 at the horizon → 1 at the band top
            img[j] = haze * (1 - t) + ref * t if top > 2 else img[j] * t + haze * (1 - t)
        else:
            g = np.clip((-a / 90) ** 0.5 * 1.6, 0, 1)
            img[j] = haze_low * 0.85 * (1 - g) + gmean * 0.25 * g
    # --- 4. level: match the procedural sky's mean luminance over the window band (5°–35°)
    band = (lat > 5) & (lat < 35)
    ys = np.sin(np.radians(lat[band]))
    proc = np.array([proc_row(tod, y) @ W_LUM for y in ys]).mean()
    cur = (img[band] @ W_LUM).mean()
    img *= proc / cur
    Lf = img @ W_LUM
    print(tod, 'sun found at lat %.1f phi %.1f, shift %d px, scale %.3g, max %.3g, band mean %.3g, zenith %.3g, horizon %.3g' % (s_lat, s_phi, shift, proc / cur, Lf.max(), (img[band] @ W_LUM).mean(), Lf[:8].mean(), Lf[(lat > 0) & (lat < 3)].mean()))
    write_hdr_rle(out_hdr, img.astype(np.float32))
    preview(img.astype(np.float32), out_png, ev=np.log2(0.18 / max(1e-6, Lf[band].mean())), w=1024)
if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    for tod in SRC:
        build(tod, os.path.join(OUT_DIR, tod + '.hdr'), os.path.join(OUT_DIR, tod + '.preview.png'))
