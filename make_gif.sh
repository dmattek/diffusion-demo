#!/bin/sh
# Regenerate docs/diffusion.gif (the animation at the top of README.md):
# N = 500 particles, D = 10, reflective walls, all particles start in the centre.
# Frames are taken at quadratically spaced times 0..T_END steps, so the early
# spreading and the late saturation of the MSD are both visible.
#
# Requires: Google Chrome (override the path with CHROME=...), python3 with Pillow.
# Takes ~1-2 minutes: Chrome is launched once per frame (parallel launches hang).
set -e
cd "$(dirname "$0")"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
FRAMES=60           # number of frames after t = 0
T_END=8000          # last simulation step captured (MSD has saturated by then)
OUT=docs/diffusion.gif

[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME (set CHROME=...)"; exit 1; }
python3 -c 'import PIL' 2>/dev/null || { echo "python3 with Pillow is required (pip install pillow)"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/frames" docs

# 1. Single-file page, modified so that it runs N steps (N from the URL hash)
#    with a seeded RNG and draws a single frame. The fixed seed makes every
#    Chrome launch reproduce the same trajectories, so the frames form one movie.
#    The page re-renders on 'resize' because headless Chrome resizes the window
#    after load, and resizing a canvas clears it.
./build.sh >/dev/null
python3 - "$TMP/h.html" <<'EOF'
import sys
out = sys.argv[1]
s = open('dist/diff_simulator.html', encoding='utf-8').read()
old = "resize();\ninitParticles('center');\nanimate();"
new = """function renderFrame() {
  let a = 12345; // mulberry32 PRNG with a fixed seed
  Math.random = function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  numSlider.value = '500'; numVal.textContent = '500';
  diffSlider.value = '10'; diffVal.textContent = '10.0';
  resize();
  initParticles('center');
  const n = +location.hash.slice(1) || 0;
  for (let k = 0; k < n; k++) step();
  drawBox(); drawHistogram(); drawMSD();
}
renderFrame();
window.addEventListener('resize', renderFrame);"""
if s.count(old) != 1:
    raise SystemExit('make_gif.sh: could not find the initialisation block in the built page — update this script')
open(out, 'w', encoding='utf-8').write(s.replace(old, new))
EOF

# 2. One screenshot per frame, at t_k = T_END * (k / FRAMES)^2
k=0
while [ $k -le $FRAMES ]; do
  t=$(( T_END * k * k / (FRAMES * FRAMES) ))
  printf '\rCapturing frame %d/%d (t = %d)   ' "$k" "$FRAMES" "$t"
  "$CHROME" --headless=new --disable-gpu --force-device-scale-factor=1 --hide-scrollbars \
    --virtual-time-budget=800 --window-size=842,1360 \
    --screenshot="$TMP/frames/f$(printf %03d $k).png" "file://$TMP/h.html#$t" >/dev/null 2>&1
  k=$((k + 1))
done
echo

# 3. Crop to the app, scale, shared palette, assemble looping GIF
python3 - "$TMP/frames" "$OUT" <<'EOF'
import sys, glob, os
from PIL import Image
frames_dir, out = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(os.path.join(frames_dir, 'f*.png')))
frames = []
for f in files:
    im = Image.open(f).convert('RGB')
    if im.size != (842, 1360):
        raise SystemExit(f'make_gif.sh: unexpected screenshot size {im.size} for {f}')
    frames.append(im.crop((16, 0, 826, 1356)).resize((540, 904), Image.LANCZOS))
# Palette from all frames together, plus large swatches of the plot colours:
# thin curves cover too few pixels and would otherwise be merged (orange -> pink)
w, h = frames[0].size
key_colours = [(100, 255, 218), (255, 107, 157), (255, 184, 108)]  # particles/data, 2Dt, confined
montage = Image.new('RGB', (w, h * (len(frames) + len(key_colours))))
for k, f in enumerate(frames):
    montage.paste(f, (0, k * h))
for j, c in enumerate(key_colours):
    montage.paste(Image.new('RGB', (w, h), c), (0, (len(frames) + j) * h))
palette = montage.quantize(colors=128, method=Image.Quantize.MEDIANCUT)
q = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]
durations = [1000] + [100] * (len(q) - 2) + [2500]   # pause at start, 100 ms/frame, hold the end
q[0].save(out, save_all=True, append_images=q[1:], duration=durations, loop=0, optimize=True, disposal=1)
print(f'Wrote {out}: {len(q)} frames, {os.path.getsize(out) // 1024} KB')
EOF
