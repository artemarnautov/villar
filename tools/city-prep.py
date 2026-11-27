# Villar — city facade prep (engine). Usage: python3 tools/city-prep.py <checkout of zuujis-cc0/ambientcg-materials-facade> [out dir]
# Builds site/assets/city/*.jpg (512², JPEG q82) from CC0 ambientCG facade sets (see site/assets/materials/LICENSES.md).
import sys, os
from PIL import Image
SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'site/assets/city'
PAIRS = {
  'glass-a': 'Facade001', 'glass-b': 'Facade005', 'glass-c': 'Facade006',
  'stone-a': 'Facade015', 'stone-b': 'Facade014', 'stone-c': 'Facade019A',
  'night-glass-a': 'Facade010', 'night-glass-b': 'Facade007', 'night-glass-c': 'Facade008',
  'night-stone-a': 'Facade016', 'night-stone-b': 'Facade011', 'night-stone-c': 'Facade019C',
}
os.makedirs(OUT, exist_ok=True)
for out, src in PAIRS.items():
    im = Image.open(f'{SRC}/{src}/1K-JPG/{src}_1K-JPG_Color.jpg').convert('RGB').resize((512, 512), Image.LANCZOS)
    im.save(f'{OUT}/{out}.jpg', quality=82, optimize=True)
