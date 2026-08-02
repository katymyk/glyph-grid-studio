/**
 * Verification harness for the halftone engine's pure math.
 *
 * There is no test runner in this repo (deliberate). This runs the DOM-free engine
 * modules under plain node, which covers the parts most likely to be subtly wrong:
 * screen geometry, tone mapping, dot-size response, the dither algorithms, and the
 * run merge.
 *
 * Run it with:  npm run check:math
 * (that compiles src/engine/halftone/*, src/engine/tone.ts, src/engine/rng.ts and
 * src/domain/params.ts into app/.check first — those files must stay DOM-free.)
 */
const D = __dirname + '/../.check';
const tone = require(D + '/engine/tone.js');
const rng = require(D + '/engine/rng.js');
const screen = require(D + '/engine/halftone/screen.js');
const sizeMap = require(D + '/engine/halftone/sizeMap.js');
const bayer = require(D + '/engine/halftone/bayer.js');
const dither = require(D + '/engine/halftone/dither.js');
const runs = require(D + '/engine/halftone/runs.js');
const field = require(D + '/engine/halftone/field.js');
const params = require(D + '/domain/params.js');
const timeline = require(D + '/domain/timeline.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const sec = (s) => console.log(`\n== ${s}`);

// ---------------------------------------------------------------- V1/V2 tone
sec('V1 mapTone table');
const T = [
  [0.5, {}, 0.5], [0.0, {}, 0.0], [1.0, {}, 1.0],
  [0.25, { contrast: 200 }, 0.0], [0.75, { contrast: 200 }, 1.0], [0.25, { contrast: 50 }, 0.375],
  [0.5, { brightness: 25 }, 0.75], [0.5, { brightness: -25 }, 0.25], [0.2, { brightness: 100 }, 1.0],
  [0.5, { gamma: 180 }, 0.680395], [0.25, { gamma: 180 }, 0.462937], [0.5, { gamma: 50 }, 0.25],
  [0.5, { threshold: 50 }, 0.25], [0.5, { threshold: -50 }, 0.75], [0.5, { threshold: 100 }, 0.0],
  [0.3, { invert: true }, 0.7],
  [0.5, { contrast: 250, brightness: -20, gamma: 180, threshold: 30 }, 0.362285],
  [0.9, { contrast: 300, brightness: 10 }, 1.0], [0.1, { contrast: 300, brightness: -10 }, 0.0],
];
let toneBad = 0;
for (const [lum, o, want] of T) {
  const got = tone.mapTone(lum, o);
  if (!near(got, want, 1e-5)) { toneBad++; console.log(`      lum=${lum} ${JSON.stringify(o)} want ${want} got ${got}`); }
}
ok('all 19 tone vectors', toneBad === 0, `${T.length - toneBad}/${T.length}`);
ok('gamma:180 reproduces the reference gamma checkbox (pow 1/1.8)',
  near(tone.mapTone(0.5, { gamma: 180 }), Math.pow(0.5, 1 / 1.8), 1e-12));

sec('V2 anti-drift lock: mapTone === the expression ASCII mode used');
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
let mism = 0, n = 0;
for (const b of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1])
  for (const c of [20, 50, 100, 180, 300])
    for (const br of [-100, -40, 0, 40, 100]) {
      n++;
      const want = clamp01((b - 0.5) * (c / 100) + 0.5 + br / 100);
      if (!near(tone.mapTone(b, { contrast: c, brightness: br }), want, 1e-12)) mism++;
    }
ok('0 mismatches across contrast x brightness', mism === 0, `${n - mism}/${n}`);
// inkFromLum must reproduce ascii's old `t = invert ? v : 1 - v`
let inkBad = 0;
for (const b of [0, 0.2, 0.5, 0.77, 1]) for (const inv of [false, true]) {
  const v = clamp01((b - 0.5) * 1 + 0.5);
  const want = inv ? v : 1 - v;
  if (!near(tone.inkFromLum(b, { invert: inv }), want, 1e-12)) inkBad++;
}
ok('inkFromLum matches ascii rampChar polarity', inkBad === 0);

// ------------------------------------------------------------ V3-V5 sizeMap
sec('V3-V5 coverage / dot size mapping');
ok('coverSquare(1/sqrt2) ~= 1', near(sizeMap.coverSquare(Math.SQRT1_2), 1, 1e-12),
  String(sizeMap.coverSquare(Math.SQRT1_2)));
ok('coverHex(1/sqrt3) ~= 1', near(sizeMap.coverHex(1 / Math.sqrt(3)), 1, 1e-12),
  String(sizeMap.coverHex(1 / Math.sqrt(3))));
ok('coverSquare(0.5) === pi/4', near(sizeMap.coverSquare(0.5), Math.PI / 4, 1e-15));
let overMax = 0;
for (let d = 0; d <= 0.5; d += 0.001) {
  const a = Math.SQRT1_2 * Math.sqrt(d);
  overMax = Math.max(overMax, Math.abs(sizeMap.coverSquare(a) - (Math.PI / 2) * d));
}
ok("'area' map over-inks by exactly pi/2 below dark=0.5", overMax < 1e-14, `max dev ${overMax.toExponential(2)}`);
for (const lat of ['square', 'hex']) {
  const lut = sizeMap.coverageLUT(lat);
  const cover = sizeMap.coverOf(lat);
  let worst = 0;
  for (let k = 0; k <= 2000; k++) {
    const d = k / 2000;
    worst = Math.max(worst, Math.abs(cover(sizeMap.lutLookup(lut, d)) - d));
  }
  ok(`coverageLUT(${lat}) round-trip <= 1e-3`, worst <= 1e-3, `worst ${worst.toExponential(2)}`);
}
// 'coverage' map is tone-accurate at scale 1
{
  const lut = sizeMap.coverageLUT('square');
  const cell = 10, scale = 1;
  const rMax = cell * screen.COVER_R.square * scale * 1.02;
  let worst = 0;
  for (const d of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const r = sizeMap.dotRadius(d, rMax, 'coverage', lut, cell, scale);
    worst = Math.max(worst, Math.abs(sizeMap.coverSquare(r / cell) - d));
  }
  ok("'coverage' map reproduces requested ink within 1e-3", worst <= 1e-3, `worst ${worst.toExponential(2)}`);
}
// darkFloor really is the inverse of the size map
{
  const lut = sizeMap.coverageLUT('square');
  const cell = 8, scale = 1, rMax = cell * screen.COVER_R.square * scale * 1.02;
  let bad = 0;
  for (const map of ['area', 'linear', 'coverage']) {
    const f = sizeMap.darkFloor(0.5, rMax, map, 'square', cell, scale);
    const rAt = sizeMap.dotRadius(f, rMax, map, lut, cell, scale);
    if (!near(rAt, 0.5, 2e-3)) { bad++; console.log(`      ${map}: darkFloor->r = ${rAt}`); }
  }
  ok('darkFloor(minPx) inverts each size map', bad === 0);
}

// ------------------------------------------------------------- V6-V8 screen
sec('V6 screen() covers every visible site (property test)');
function bruteCover(W, H, cell, ang, lat) {
  const margin = screen.COVER_R[lat] * 1.02 * cell;
  const s = screen.screen(W, H, cell, ang, lat, margin);
  const a = (ang * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const rowPitch = cell * screen.ROW_PITCH[lat];
  const off = lat === 'hex' ? 0.5 : 0;
  // brute force a window 8 rings wider on every side
  let miss = 0;
  for (let j = s.jMin - 8; j <= s.jMax + 8; j++) {
    const ly = j * rowPitch;
    const shift = off && j & 1 ? off : 0;
    for (let i = s.iMin - 8; i <= s.iMax + 8; i++) {
      const lx = (i + shift) * cell;
      const x = lx * cos - ly * sin + W / 2;
      const y = lx * sin + ly * cos + H / 2;
      const visible = x >= -margin && x <= W + margin && y >= -margin && y <= H + margin;
      if (!visible) continue;
      if (i < s.iMin || i > s.iMax || j < s.jMin || j > s.jMax) miss++;
    }
  }
  return miss;
}
const SHAPES = [[1920, 1080], [1080, 1920], [1080, 1080], [3840, 2160], [800, 2400], [2400, 300]];
const CELLS = [3, 4, 5, 6, 7, 8, 11, 13, 17, 26, 40, 64];
const ANGLES = [];
for (let a = 0; a <= 90; a += 1) ANGLES.push(a);
for (const a of [15.5, 22.5, 37.4, 44.9, 45, 45.1, 63.43, 71.57, 89.9]) ANGLES.push(a);
for (const lat of ['square', 'hex']) {
  let miss = 0, cases = 0;
  for (const [W, H] of SHAPES) for (const c of CELLS) for (const a of ANGLES) { cases++; miss += bruteCover(W, H, c, a, lat); }
  ok(`${lat}: 0 missed sites`, miss === 0, `${cases} cases, ${miss} misses`);
}

sec('V6b coverage gap: the emitted lattice really does cover the canvas');
// worst distance from any canvas point to the nearest emitted site must be <= COVER_R
for (const lat of ['square', 'hex']) {
  let worstRatio = 0;
  for (const ang of [0, 15, 30, 45, 60, 75, 90]) {
    const cell = 12;
    const margin = screen.COVER_R[lat] * 1.02 * cell;
    const s = screen.screen(1920, 1080, cell, ang, lat, margin);
    const pts = [];
    screen.forEachSite(s, 1920, 1080, (x, y) => pts.push([x, y]));
    for (let gy = 0; gy <= 40; gy++) for (let gx = 0; gx <= 40; gx++) {
      const px = (gx / 40) * 1920, py = (gy / 40) * 1080;
      let best = Infinity;
      for (const [qx, qy] of pts) { const d = (qx - px) ** 2 + (qy - py) ** 2; if (d < best) best = d; }
      worstRatio = Math.max(worstRatio, Math.sqrt(best) / cell);
    }
  }
  ok(`${lat}: worst gap <= COVER_R (${screen.COVER_R[lat].toFixed(4)} cells)`,
    worstRatio <= screen.COVER_R[lat] + 1e-9, `worst ${worstRatio.toFixed(4)}`);
}

sec('V7 scan cost vs the reference square-window formula');
{
  let tight = 0, ref = 0;
  for (const [W, H] of SHAPES) for (const c of CELLS) for (const a of ANGLES) {
    const s = screen.screen(W, H, c, a, 'square', screen.COVER_R.square * 1.02 * c);
    tight += (s.iMax - s.iMin + 1) * (s.jMax - s.jMin + 1);
    const r = Math.ceil(Math.sqrt(W * W + H * H) / c / 2) + 1;
    ref += (2 * r + 1) * (2 * r + 1);
  }
  ok('tight bounds scan >= 1.4x fewer candidate sites', ref / tight >= 1.4,
    `${(ref / tight).toFixed(3)}x  (${tight.toLocaleString()} vs ${ref.toLocaleString()})`);
}

sec('V8/V17 site counts + effectiveCell');
ok('1920x1080 cell 6 -> 57600', screen.siteCount(1920, 1080, 6, 'square') === 57600);
ok('1920x1080 cell 4 -> 129600', screen.siteCount(1920, 1080, 4, 'square') === 129600);
ok('1920x1080 cell 3 -> 230400', screen.siteCount(1920, 1080, 3, 'square') === 230400);
ok('hex packs 1.1547x more sites',
  near(screen.siteCount(1920, 1080, 12, 'hex') / screen.siteCount(1920, 1080, 12, 'square'), 2 / Math.sqrt(3), 1e-3));
const eff = (W, H, c, m) => screen.effectiveCell(W, H, c, 'square', m);
ok('uncapped returns cell unchanged (1920x1080 cell 8 @40k)', eff(1920, 1080, 8, 40000) === 8);
ok('capped raises cell (1920x1080 cell 3 @40k)', eff(1920, 1080, 3, 40000) > 3,
  `-> ${eff(1920, 1080, 3, 40000).toFixed(3)}px`);
ok('cap yields <= maxElements sites',
  screen.siteCount(1920, 1080, eff(1920, 1080, 3, 40000), 'square') <= 40001,
  `${screen.siteCount(1920, 1080, eff(1920, 1080, 3, 40000), 'square')} sites`);
ok('4K capped too', eff(3840, 2160, 4, 40000) > 4, `-> ${eff(3840, 2160, 4, 40000).toFixed(2)}px`);
ok('effectiveCell is monotone/continuous through the boundary', (() => {
  let prev = 0, mono = true;
  for (let c = 1; c < 30; c += 0.25) { const e = eff(1920, 1080, c, 40000); if (e < prev - 1e-9) mono = false; prev = e; }
  return mono;
})());

// -------------------------------------------------------------- V9 bayer
sec('V9 Bayer matrices');
const CANON8 = [
  [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]];
const b8 = bayer.bayerInts(8);
ok('bayerInts(8) === canonical Bayer 8x8', JSON.stringify(b8) === JSON.stringify(CANON8));
ok('bayerInts(4) === canonical Bayer 4x4',
  JSON.stringify(bayer.bayerInts(4)) === JSON.stringify([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]));
ok('BAYER8 normalized thresholds strictly inside (0,1)',
  bayer.BAYER8.every((r) => r.every((v) => v > 0 && v < 1)));
ok('bayerInts(16) is a permutation of 0..255', (() => {
  const f = bayer.bayerInts(16).flat().sort((a, b) => a - b);
  return f.length === 256 && f.every((v, i) => v === i);
})());

// --------------------------------------------------------------- V10 hash
sec('V10 hash2D');
ok('hash2D(0,0,0) !== 0 (no dead spot at the origin)', rng.hash2D(0, 0, 0) !== 0,
  String(rng.hash2D(0, 0, 0)));
{
  const bins = new Array(16).fill(0);
  let sum = 0, N = 0;
  const vals = new Map();
  for (let s = 0; s < 4; s++) for (let j = -150; j < 150; j++) for (let i = -150; i < 150; i++) {
    const v = rng.hash2D(i, j, s); bins[Math.min(15, (v * 16) | 0)]++; sum += v; N++;
    if (s === 1) vals.set(i + ',' + j, v);
  }
  const expect = N / 16;
  const chi2 = bins.reduce((a, b) => a + (b - expect) ** 2 / expect, 0);
  ok('uniform: chi2(15 df) < 30', chi2 < 30, `chi2=${chi2.toFixed(1)} mean=${(sum / N).toFixed(6)}`);
  const cov = (dx, dy) => {
    let s = 0, m = 0, c = 0;
    for (let j = -140; j < 140; j++) for (let i = -140; i < 140; i++) {
      const a = vals.get(i + ',' + j), b = vals.get(i + dx + ',' + (j + dy));
      if (a === undefined || b === undefined) continue;
      s += (a - 0.5) * (b - 0.5); m++;
    }
    c = s / m; return c;
  };
  ok('|cov(i+1)| < 1e-3', Math.abs(cov(1, 0)) < 1e-3, cov(1, 0).toExponential(2));
  ok('|cov(j+1)| < 1e-3', Math.abs(cov(0, 1)) < 1e-3, cov(0, 1).toExponential(2));
  ok('stream 0 vs 1 decorrelated', (() => {
    let s = 0, m = 0;
    for (let j = 0; j < 300; j++) for (let i = 0; i < 300; i++) {
      s += (rng.hash2D(i, j, 7, 0) - 0.5) * (rng.hash2D(i, j, 7, 1) - 0.5); m++;
    }
    return Math.abs(s / m) < 1e-3;
  })());
  ok('seed n vs n+1 decorrelated', (() => {
    let s = 0, m = 0;
    for (let j = 0; j < 300; j++) for (let i = 0; i < 300; i++) {
      s += (rng.hash2D(i, j, 7) - 0.5) * (rng.hash2D(i, j, 8) - 0.5); m++;
    }
    return Math.abs(s / m) < 1e-3;
  })());
  ok('hash2D is order-independent (pure function of inputs)',
    rng.hash2D(11, 22, 3, 1) === rng.hash2D(11, 22, 3, 1));
  ok('not symmetric in i/j (jitter would mirror about the diagonal)',
    rng.hash2D(5, 9, 1) !== rng.hash2D(9, 5, 1));
}

// ------------------------------------------------------------ V12-V14 dither
sec('V12-V14 dither determinism + purity');
function ramp(cols, rows) {
  const g = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    g[y * cols + x] = ((x / cols) * 0.7 + (y / rows) * 0.3);
  }
  return g;
}
const ALGOS = ['floyd', 'atkinson', 'bayer4', 'bayer8', 'noise'];
const OPT = { tone: {}, cut: 0.5, seed: 7, frame: 0, grain: 1, serpentine: false };
const withCut = (th) => ({ ...OPT, cut: tone.inkThreshold({ threshold: th }) });
const C = 120, R = 80;
const src = ramp(C, R);
for (const algo of ALGOS) {
  const a = dither.dither(src, C, R, algo, OPT);
  const b = dither.dither(src, C, R, algo, OPT);
  ok(`${algo}: same params twice -> byte-identical`, Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0);
}
ok('src Float32Array is NOT mutated by error diffusion (ascii-corruption guard)', (() => {
  const before = Float32Array.from(src);
  dither.dither(src, C, R, 'floyd', OPT);
  dither.dither(src, C, R, 'atkinson', OPT);
  return before.every((v, i) => v === src[i]);
})());
ok('noise: different seed -> different field', (() => {
  const a = dither.dither(src, C, R, 'noise', OPT);
  const b = dither.dither(src, C, R, 'noise', { ...OPT, seed: 8 });
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0;
})());
ok('noise: frame 0 freezes grain, frame n animates it', (() => {
  const f0 = dither.dither(src, C, R, 'noise', { ...OPT, frame: 0 });
  const f0b = dither.dither(src, C, R, 'noise', { ...OPT, frame: 0 });
  const f1 = dither.dither(src, C, R, 'noise', { ...OPT, frame: 1 });
  return Buffer.compare(Buffer.from(f0), Buffer.from(f0b)) === 0
    && Buffer.compare(Buffer.from(f0), Buffer.from(f1)) !== 0;
})());
ok('bayer/noise are position-keyed: a sub-window matches the full grid', (() => {
  // same (x,y) must give the same threshold regardless of grid extent
  for (const algo of ['bayer8', 'noise']) {
    const full = dither.dither(src, C, R, algo, OPT);
    const sub = new Float32Array(C * 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < C; x++) sub[y * C + x] = src[y * C + x];
    const s = dither.dither(sub, C, 40, algo, OPT);
    for (let y = 0; y < 40; y++) for (let x = 0; x < C; x++) {
      if (s[y * C + x] !== full[y * C + x]) return false;
    }
  }
  return true;
})());
ok('atkinson differs from floyd (it discards 1/4 of the error by design)', (() => {
  const a = dither.dither(src, C, R, 'floyd', OPT);
  const b = dither.dither(src, C, R, 'atkinson', OPT);
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0;
})());
ok('atkinson crushes the extremes more than floyd on a gradient', (() => {
  // 3/4 diffusion leaves more of the error behind -> flatter, more contrasted result
  const fl = dither.dither(src, C, R, 'floyd', OPT).reduce((a, b) => a + b, 0);
  const at = dither.dither(src, C, R, 'atkinson', OPT).reduce((a, b) => a + b, 0);
  return at !== fl;
})());
ok('serpentine changes the floyd result', (() => {
  const a = dither.dither(src, C, R, 'floyd', OPT);
  const b = dither.dither(src, C, R, 'floyd', { ...OPT, serpentine: true });
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0;
})());
// The bug this caught: threshold used to be applied both inside the tone stage AND
// as the cut, which doubled it for floyd/atkinson and cancelled it for bayer.
sec('threshold is applied exactly once, in every algorithm');
for (const algo of ALGOS) {
  const ink = (th) => dither.dither(src, C, R, algo, withCut(th)).reduce((a, b) => a + b, 0);
  const lo = ink(-60), mid = ink(0), hi = ink(60);
  ok(`${algo}: more threshold -> monotonically more ink`, lo < mid && mid < hi,
    `${lo} < ${mid} < ${hi}`);
}
ok('shaping tone still bites: contrast changes the bitmap', (() => {
  const a = dither.dither(src, C, R, 'bayer8', OPT);
  const b = dither.dither(src, C, R, 'bayer8', { ...OPT, tone: { contrast: 250 } });
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0;
})());
ok('brightness shifts ink monotonically', (() => {
  const ink = (br) => dither.dither(src, C, R, 'floyd', { ...OPT, tone: { brightness: br } })
    .reduce((a, b) => a + b, 0);
  return ink(40) < ink(0) && ink(0) < ink(-40); // brighter source -> less ink
})());
ok('gamma changes the bitmap', (() => {
  const a = dither.dither(src, C, R, 'floyd', OPT);
  const b = dither.dither(src, C, R, 'floyd', { ...OPT, tone: { gamma: 180 } });
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0;
})());
ok('pure black -> all ink, pure white -> none (bayer +0.5 centring)', (() => {
  const black = new Float32Array(64).fill(0), white = new Float32Array(64).fill(1);
  const kb = dither.dither(black, 8, 8, 'bayer8', OPT).reduce((a, b) => a + b, 0);
  const kw = dither.dither(white, 8, 8, 'bayer8', OPT).reduce((a, b) => a + b, 0);
  return kb === 64 && kw === 0;
})());

// --------------------------------------------------------------- V15 runs
sec('V15 run merge is lossless and seamless');
{
  const cols = 97, rows = 61, W = 1920, H = 1080;
  const bin = new Uint8Array(cols * rows);
  for (let i = 0; i < bin.length; i++) bin[i] = rng.hash2D(i % cols, (i / cols) | 0, 3) < 0.5 ? 1 : 0;
  const out = [];
  runs.mergeRuns(bin, cols, rows, W, H, 1, '#000', out);
  // rasterize back through the same rounded-cumulative grid
  const back = new Uint8Array(cols * rows);
  let seamOk = true;
  for (const p of out) {
    const x0 = Math.round(p.x - p.w / 2), x1 = Math.round(p.x + p.w / 2);
    const y0 = Math.round(p.y - p.h / 2);
    if (!Number.isInteger(x0) || !Number.isInteger(x1)) seamOk = false;
    // map px edges back to cell indices
    let c0 = -1, c1 = -1, r = -1;
    for (let c = 0; c <= cols; c++) if (Math.round((c * W) / cols) === x0) { c0 = c; break; }
    for (let c = 0; c <= cols; c++) if (Math.round((c * W) / cols) === x1) { c1 = c; break; }
    for (let rr = 0; rr <= rows; rr++) if (Math.round((rr * H) / rows) === y0) { r = rr; break; }
    if (c0 < 0 || c1 < 0 || r < 0) { seamOk = false; continue; }
    for (let c = c0; c < c1; c++) back[r * cols + c] = 1;
  }
  ok('rects rasterize back to the exact input bitmap', Buffer.compare(Buffer.from(bin), Buffer.from(back)) === 0);
  ok('every rect edge lands on an integer pixel boundary', seamOk);
  ok('all rects use centre anchoring with positive extent',
    out.every((p) => p.shape === 'pixel' && p.w > 0 && p.h > 0 && p.rotation === 0));
  // adjacent runs in a row must share an exact edge (no gaps, no overlap)
  let contiguous = true;
  const byRow = new Map();
  for (const p of out) {
    const k = p.y; if (!byRow.has(k)) byRow.set(k, []); byRow.get(k).push(p);
  }
  for (const list of byRow.values()) {
    list.sort((a, b) => a.x - b.x);
    for (let i = 1; i < list.length; i++) {
      const prevEnd = list[i - 1].x + list[i - 1].w / 2;
      const thisStart = list[i].x - list[i].w / 2;
      if (thisStart < prevEnd - 1e-9) contiguous = false;
    }
  }
  ok('no overlapping runs within a row', contiguous);
  // polarity: rect COUNT is near-invariant to invert even when ink counts differ
  const inv = [];
  runs.mergeRuns(bin, cols, rows, W, H, 0, '#000', inv);
  ok('rect count is polarity-invariant to within ~rows',
    Math.abs(out.length - inv.length) <= rows, `${out.length} vs ${inv.length}`);
  // run-merge reduction on a photographic-like dithered source
  const dbin = dither.dither(ramp(480, 270), 480, 270, 'floyd', OPT);
  const dout = [];
  runs.mergeRuns(dbin, 480, 270, W, H, 1, '#000', dout);
  const inkCells = dbin.reduce((a, b) => a + b, 0);
  ok('run merge reduces element count on a gradient', dout.length < inkCells,
    `${inkCells} ink cells -> ${dout.length} rects (${(inkCells / dout.length).toFixed(1)}x)`);
}

// ------------------------------------------------------------- V16 params
sec('V16 keyframed string params step monotonically (no overshoot flip-flop)');
{
  const mk = (t, value, easeOut, easeIn) => ({ t, value, easeOut, easeIn });
  for (const curve of ['cubic', 'back', 'elastic']) {
    const p = { kind: 'keys', keys: [mk(0, 'halftone', curve, curve), mk(1, 'floyd', curve, curve)] };
    const seq = [];
    for (let k = 0; k <= 60; k++) seq.push(params.resolveParam(p, k / 60) === 'halftone' ? 'h' : 'F');
    const flips = seq.slice(1).filter((v, i) => v !== seq[i]).length;
    ok(`easeIn=${curve}: exactly one transition`, flips === 1, seq.join(''));
  }
  const pn = { kind: 'keys', keys: [mk(0, 0, 'cubic', 'cubic'), mk(1, 100, 'cubic', 'cubic')] };
  ok('numeric params still interpolate', params.resolveParam(pn, 0.5) > 0 && params.resolveParam(pn, 0.5) < 100);
}

// --------------------------------------------------------------- field
sec('field sampling');
{
  const f = { cols: 4, rows: 2, lum: new Float32Array([0, 1, 0, 1, 1, 0, 1, 0]),
    rgb: new Uint8ClampedArray(24), alpha: new Uint8ClampedArray([255, 255, 0, 255, 255, 255, 255, 255]) };
  ok('lumAt clamps at the edges', near(f.lum[0], tone.mapTone(field.lumAt(f, -0.5, -0.5), {}), 1e-9));
  ok('lumAt interpolates between samples', (() => {
    const v = field.lumAt(f, 0.25, 0.25); return v > 0 && v < 1;
  })());
  ok('alphaAt reads the alpha plane', field.alphaAt(f, 0.6, 0.2) === 0);
  ok('workingWidth is a power of two in [512,2048]', (() => {
    for (const W of [100, 600, 1080, 1920, 2400, 3840, 8000]) {
      const w = field.workingWidth(W);
      if (w < 512 || w > 2048) return false;
      if (Math.log2(w) % 1 !== 0) return false;
    }
    return true;
  })());
  ok('workingWidth depends only on W (stable while cell/angle animate)',
    field.workingWidth(1920) === field.workingWidth(1920));
  ok('workingHeight matches the canvas aspect',
    near(field.workingHeight(1920, 1080) / field.workingWidth(1920), 1080 / 1920, 1e-3));
  ok('>= 2 samples per dot at the capped minimum cell', (() => {
    for (const [W, H] of [[1920, 1080], [1080, 1080], [3840, 2160]]) {
      const c = screen.effectiveCell(W, H, 1, 'square', 40000);
      if ((field.workingWidth(W) * c) / W < 2) return false;
    }
    return true;
  })());
}

// ------------------------------------------------- assembled dot/dither pipelines
const dots = require(D + '/engine/halftone/dots.js');

/** A synthetic source: horizontal luminance ramp, fully opaque unless `hole` carves a
    transparent right-hand third (to test alpha gating). */
function makeField(cols, rows, hole = false) {
  const lum = new Float32Array(cols * rows);
  const rgb = new Uint8ClampedArray(cols * rows * 3);
  const alpha = new Uint8ClampedArray(cols * rows).fill(255);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    lum[i] = x / (cols - 1);
    rgb[i * 3] = 200; rgb[i * 3 + 1] = 40; rgb[i * 3 + 2] = 10;
    if (hole && x > (cols * 2) / 3) alpha[i] = 0;
  }
  return { cols, rows, lum, rgb, alpha };
}

const CFG = {
  cell: 12, angle: 45, lattice: 'square', shape: 'dot', scale: 1, sizeMap: 'area',
  gain: 1, minDot: 0.35, jitter: 0, thickness: 0.35, tone: {}, color: '#101010',
  useImgColors: false, seed: 1,
};

sec('assembled dot screen');
{
  const W = 960, H = 540;
  const f = makeField(512, 288);
  const out = dots.buildDots(f, W, H, CFG);
  ok('produces dots', out.length > 100, `${out.length} dots`);
  ok('every dot is a positive-extent shape placement',
    out.every((p) => p.shape === 'dot' && p.w > 0 && p.h === p.w && p.alpha === 1 && p.rotation === 0));
  ok('dots stay within the canvas + one cell of margin',
    out.every((p) => p.x > -CFG.cell * 2 && p.x < W + CFG.cell * 2 && p.y > -CFG.cell * 2 && p.y < H + CFG.cell * 2));
  ok('all dots take the ink colour', out.every((p) => p.color === '#101010'));
  ok('dot count is near the site count for a mostly-dark source', (() => {
    const sites = screen.siteCount(W, H, CFG.cell, 'square');
    return out.length > sites * 0.5 && out.length <= sites * 1.35;
  })(), `${out.length} vs ${screen.siteCount(W, H, CFG.cell, 'square')} sites`);

  // The screen must track the image: dark (left) dots bigger than light (right) dots.
  const left = out.filter((p) => p.x < W * 0.25);
  const right = out.filter((p) => p.x > W * 0.75);
  const avg = (a) => a.reduce((s, p) => s + p.w, 0) / Math.max(1, a.length);
  ok('dark side dots are larger than light side dots',
    avg(left) > avg(right) * 1.5, `${avg(left).toFixed(2)}px vs ${avg(right).toFixed(2)}px`);
  ok('no dot exceeds the tiling diameter (x scale x fudge)',
    out.every((p) => p.w <= CFG.cell * screen.COVER_R.square * 2 * 1.02 + 1e-9));

  ok('determinism: same inputs -> identical output', (() => {
    const a = dots.buildDots(f, W, H, CFG), b = dots.buildDots(f, W, H, CFG);
    return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.w === b[i].w);
  })());

  sec('dot screen: params actually bite');
  ok('invert flips which side gets the big dots', (() => {
    const inv = dots.buildDots(f, W, H, { ...CFG, tone: { invert: true } });
    const l = avg(inv.filter((p) => p.x < W * 0.25)), r = avg(inv.filter((p) => p.x > W * 0.75));
    return r > l * 1.5;
  })());
  ok('a finer cell yields more dots', dots.buildDots(f, W, H, { ...CFG, cell: 6 }).length > out.length);
  ok('hex lattice yields ~15% more dots than square', (() => {
    const hex = dots.buildDots(f, W, H, { ...CFG, lattice: 'hex' });
    const ratio = hex.length / out.length;
    return ratio > 1.05 && ratio < 1.30;
  })());
  ok('dotScale scales the dots', (() => {
    const big = dots.buildDots(f, W, H, { ...CFG, scale: 1.5 });
    return avg(big) > avg(out) * 1.3;
  })());
  ok('fill gain grows the midtones', (() => {
    const more = dots.buildDots(f, W, H, { ...CFG, gain: 1.6 });
    return avg(more) > avg(out);
  })());
  ok('minDot culls the faintest dots', (() => {
    const strict = dots.buildDots(f, W, H, { ...CFG, minDot: 3 });
    return strict.length < out.length;
  })());
  ok('minDot 0 keeps more dots than a 2px floor',
    dots.buildDots(f, W, H, { ...CFG, minDot: 0 }).length >= dots.buildDots(f, W, H, { ...CFG, minDot: 2 }).length);
  ok('jitter displaces dots but keeps the count', (() => {
    const j = dots.buildDots(f, W, H, { ...CFG, jitter: 0.8 });
    const moved = j.some((p, i) => out[i] && Math.abs(p.x - out[i].x) > 0.5);
    return moved && Math.abs(j.length - out.length) < out.length * 0.1;
  })());
  ok('jitter is reproducible for a given seed', (() => {
    const a = dots.buildDots(f, W, H, { ...CFG, jitter: 0.8 });
    const b = dots.buildDots(f, W, H, { ...CFG, jitter: 0.8 });
    return a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
  })());
  ok('a different seed changes the jitter pattern', (() => {
    const a = dots.buildDots(f, W, H, { ...CFG, jitter: 0.8, seed: 1 });
    const b = dots.buildDots(f, W, H, { ...CFG, jitter: 0.8, seed: 2 });
    return a.some((p, i) => b[i] && p.x !== b[i].x);
  })());
  ok('changing the angle does NOT reshuffle jitter magnitudes (positional hash)', (() => {
    // a stream-based RNG would give a wholly different displacement distribution
    const a = dots.buildDots(f, W, H, { ...CFG, jitter: 0.8, angle: 45 });
    const b = dots.buildDots(f, W, H, { ...CFG, jitter: 0.8, angle: 46 });
    const spread = (l) => { const m = l.reduce((s, p) => s + p.w, 0) / l.length; return m; };
    return Math.abs(spread(a) - spread(b)) < spread(a) * 0.05;
  })());
  ok('useImgColors takes colour from the source', (() => {
    const c = dots.buildDots(f, W, H, { ...CFG, useImgColors: true });
    return c.length > 0 && c.every((p) => p.color.startsWith('rgb('));
  })());
  ok('dotShape is carried through to the placement',
    dots.buildDots(f, W, H, { ...CFG, shape: 'diamond' }).every((p) => p.shape === 'diamond'));
  ok('each size map gives a different midtone weight', (() => {
    const a = avg(dots.buildDots(f, W, H, { ...CFG, sizeMap: 'area' }));
    const c = avg(dots.buildDots(f, W, H, { ...CFG, sizeMap: 'coverage' }));
    const l = avg(dots.buildDots(f, W, H, { ...CFG, sizeMap: 'linear' }));
    // classic over-inks, linear under-inks, accurate sits between
    return a > c && c > l;
  })(), 'area > coverage > linear');

  sec('dot screen: transparency (the transparent-PNG case)');
  {
    const holed = makeField(512, 288, true);
    const out2 = dots.buildDots(holed, W, H, CFG);
    ok('no dots land in the transparent region',
      !out2.some((p) => p.x > W * 0.72 && p.x > 0 && p.x < W),
      `${out2.filter((p) => p.x > W * 0.72 && p.x < W).length} strays`);
    ok('dots still appear in the opaque region', out2.some((p) => p.x < W * 0.6));
    ok('a fully transparent source emits nothing', (() => {
      const blank = makeField(64, 36);
      blank.alpha.fill(0);
      return dots.buildDots(blank, W, H, CFG).length === 0;
    })());
  }
}

sec('assembled dither pipeline');
{
  const W = 960, H = 540;
  const cols = 240, rows = 135;
  const f = makeField(cols, rows);
  const OPTS = { tone: {}, cut: 0.5, seed: 5, frame: 0, grain: 1, serpentine: false };
  for (const algo of ALGOS) {
    const out = runs.buildDither(f, W, H, algo, OPTS, false, '#000');
    ok(`${algo}: emits pixel runs`, out.length > 0 && out.every((p) => p.shape === 'pixel'),
      `${out.length} runs`);
  }
  const base = runs.buildDither(f, W, H, 'floyd', OPTS, false, '#000');
  const inv = runs.buildDither(f, W, H, 'floyd', OPTS, true, '#000');
  // Run COUNT is polarity-invariant (the runs of either state in a binary row differ
  // by at most one per row) — so assert the geometry differs, not the count.
  ok('invert emits a different run geometry', (() => {
    if (inv.length === 0) return false;
    const key = (l) => l.map((p) => `${p.x}:${p.w}:${p.y}`).join('|');
    return key(inv) !== key(base);
  })());
  ok('run count is polarity-invariant to within ~rows',
    Math.abs(inv.length - base.length) <= rows, `${base.length} vs ${inv.length}`);
  ok('ink + inverted ink tile the canvas area', (() => {
    const area = (l) => l.reduce((s, p) => s + p.w * p.h, 0);
    return Math.abs(area(base) + area(inv) - W * H) < W * H * 0.02;
  })(), 'no gaps, no double-coverage');
  ok('runs use the ink colour', base.every((p) => p.color === '#000'));
  ok('transparent source regions emit no runs', (() => {
    const holed = makeField(cols, rows, true);
    const out = runs.buildDither(holed, W, H, 'floyd', OPTS, false, '#000');
    return !out.some((p) => p.x - p.w / 2 > W * 0.7);
  })());
  ok('a fully transparent source emits nothing', (() => {
    const blank = makeField(cols, rows);
    blank.alpha.fill(0);
    return runs.buildDither(blank, W, H, 'bayer8', OPTS, false, '#000').length === 0;
  })());
  ok('run merge beats one-box-per-cell', base.length < cols * rows,
    `${base.length} runs vs ${cols * rows} cells`);
  ok('deterministic across repeats', (() => {
    const a = runs.buildDither(f, W, H, 'noise', OPTS, false, '#000');
    const b = runs.buildDither(f, W, H, 'noise', OPTS, false, '#000');
    return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.w === b[i].w);
  })());
}

// ------------------------------------------------------ regressions (found in review)
sec('REGRESSION: transparency must hold at BOTH invert polarities');
{
  const cols = 40, rows = 30, W = 400, H = 300;
  const blank = makeField(cols, rows);
  blank.alpha.fill(0); // no source anywhere
  const O = { tone: {}, cut: 0.5, seed: 1, frame: 0, grain: 1, serpentine: false };
  for (const algo of ALGOS) {
    for (const invert of [false, true]) {
      const out = runs.buildDither(blank, W, H, algo, O, invert, '#000');
      ok(`${algo} invert=${invert}: fully transparent source emits nothing`,
        out.length === 0, `${out.length} runs`);
    }
  }
  // half-transparent: ink only where the source exists, at either polarity
  const half = makeField(cols, rows, true); // right third transparent
  for (const invert of [false, true]) {
    const out = runs.buildDither(half, W, H, 'floyd', O, invert, '#000');
    const strays = out.filter((p) => p.x - p.w / 2 > W * 0.7).length;
    ok(`floyd invert=${invert}: no ink in the transparent third`, strays === 0, `${strays} strays`);
    ok(`floyd invert=${invert}: ink still present in the opaque part`, out.length > 0);
  }
}

sec('REGRESSION: bilinear luminance must not bleed transparent black');
{
  // A hard alpha edge with WHITE opaque pixels. Un-weighted bilinear would pull the
  // stored black of the transparent side across the edge and darken it.
  const cols = 8, rows = 1;
  const f = {
    cols, rows,
    lum: new Float32Array(cols).fill(1), // all opaque pixels are white
    rgb: new Uint8ClampedArray(cols * 3).fill(255),
    alpha: new Uint8ClampedArray(cols),
  };
  for (let x = 0; x < 4; x++) f.alpha[x] = 255; // left half opaque, right half clear
  let minLum = 1;
  for (let k = 0; k <= 40; k++) {
    const nx = (k / 40) * 0.5; // sample across the opaque half up to the edge
    minLum = Math.min(minLum, field.lumAt(f, nx, 0.5));
  }
  ok('a white shape against transparency stays white up to its edge',
    near(minLum, 1, 1e-9), `min lum ${minLum.toFixed(6)}`);
  ok('a fully transparent neighbourhood reads as paper, not ink',
    field.lumAt(f, 0.95, 0.5) === 1);
  // and the dot builder must therefore put no oversized dots along the edge
  const W = 400, H = 50;
  const edge = dots.buildDots(f, W, H, { ...CFG, cell: 8 });
  ok('no dots ring the alpha edge of a white shape', edge.length === 0,
    `${edge.length} dots`);
}

sec('REGRESSION: dot jitter streams must be independent');
{
  // Test the displacement fields the way buildDots derives them — keyed on the lattice
  // indices. (Do NOT pair the output arrays by array index: jitter changes which sites
  // survive the cull, and on a rotated lattice two different sites differ in x and y
  // together, which manufactures a correlation that isn't in the jitter at all.)
  const corr = (fa, fb) => {
    let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let j = -80; j < 80; j++) for (let i = -80; i < 80; i++) {
      const a = fa(i, j), b = fb(i, j);
      n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
    }
    const cov = sab / n - (sa / n) * (sb / n);
    return cov / Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2));
  };
  const jx = (i, j) => rng.hash2D(i, j, 1, 0) * 2 - 1;
  const jy = (i, j) => rng.hash2D(i, j, 1, 1) * 2 - 1;
  const rxy = corr(jx, jy);
  ok('x- and y-jitter of the same site are uncorrelated', Math.abs(rxy) < 0.05,
    `r = ${rxy.toFixed(5)}`);
  // The specific defect: with the arguments transposed, the y field was the x field
  // shifted one row, so these two were bit-identical.
  let alias = 0;
  for (let j = -80; j < 80; j++) for (let i = -80; i < 80; i++) {
    if (jy(i, j) === jx(i, j + 1)) alias++;
  }
  ok('y-jitter(i,j) is not x-jitter(i,j+1)', alias === 0, `${alias} aliased sites`);
  const rshift = corr(jy, (i, j) => jx(i, j + 1));
  ok('...and the two are statistically unrelated', Math.abs(rshift) < 0.05,
    `r = ${rshift.toFixed(5)}`);

  const f = makeField(256, 144);
  const W = 960, H = 540;
  const base = dots.buildDots(f, W, H, { ...CFG, jitter: 0 });
  const out = dots.buildDots(f, W, H, { ...CFG, jitter: 0.9 });
  ok('jitter actually displaces the screen', (() => {
    const key = (l) => l.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join('|');
    return key(out) !== key(base);
  })());
  ok('every jittered dot sits within half a cell of an ideal lattice site', (() => {
    // Compare against the lattice itself rather than against an unjittered RUN: jitter
    // widens the scan margin (a jittered site just off-canvas can move on), so the two
    // runs legitimately enumerate different site sets and cannot be paired by index.
    const solid = makeField(64, 36);
    solid.lum.fill(0); // all black, so nothing is culled by size
    const jitter = 1;
    const out2 = dots.buildDots(solid, W, H, { ...CFG, jitter });
    const rMax = CFG.cell * screen.COVER_R.square * CFG.scale * 1.02;
    const jitPx = jitter * 0.5 * CFG.cell;
    const scr = screen.screen(W, H, CFG.cell, CFG.angle, 'square', rMax + jitPx + CFG.cell);
    const sites = [];
    screen.forEachSite(scr, W, H, (x, y) => sites.push([x, y]));
    const lim = jitPx + 1e-9;
    return out2.every((p) =>
      sites.some(([sx2, sy2]) => Math.abs(p.x - sx2) <= lim && Math.abs(p.y - sy2) <= lim),
    );
  })());
}

sec('REGRESSION: ring / cross / bar must not degenerate to a disc or square');
{
  const f = makeField(256, 144);
  const W = 960, H = 540;
  for (const shape of ['ring', 'cross', 'line']) {
    const out = dots.buildDots(f, W, H, { ...CFG, shape, thickness: 0.35 });
    ok(`${shape}: w and h differ, so the shape is not collapsed`,
      out.length > 0 && out.every((p) => p.h < p.w), `${out.length} marks`);
    ok(`${shape}: thickness is honoured`, (() => {
      const thin = dots.buildDots(f, W, H, { ...CFG, shape, thickness: 0.1 });
      const thick = dots.buildDots(f, W, H, { ...CFG, shape, thickness: 0.8 });
      const avgH = (l) => l.reduce((s, p) => s + p.h, 0) / l.length;
      return avgH(thick) > avgH(thin) * 1.5;
    })());
  }
  for (const shape of ['dot', 'square', 'diamond']) {
    const out = dots.buildDots(f, W, H, { ...CFG, shape, thickness: 0.35 });
    ok(`${shape}: stays square (w === h)`, out.every((p) => p.w === p.h));
  }
  ok('a ring never closes into a disc (h < w always)', (() => {
    for (const th of [0.05, 0.5, 0.9, 1.5]) {
      const out = dots.buildDots(f, W, H, { ...CFG, shape: 'ring', thickness: th });
      if (!out.every((p) => p.h < p.w)) return false;
    }
    return true;
  })());
  ok('thickness never drops below half a pixel', (() => {
    const out = dots.buildDots(f, W, H, { ...CFG, shape: 'ring', thickness: 0.0001 });
    return out.every((p) => p.h >= 0.5);
  })());
}

// ------------------------------------------------------------------ frame grid
sec('the frame grid (fps is the preview rate now, not just an export setting)');
{
  const { frameCount, frameAt, timeOfFrame, frameAtWall } = timeline;
  ok('12fps over 3s is 36 frames', frameCount({ fps: 12, duration: 3 }) === 36);
  ok('a very short loop still has one frame', frameCount({ fps: 25, duration: 0.001 }) === 1);
  ok('25fps over 0.1s is 3 frames (round, matching every exporter)',
    frameCount({ fps: 25, duration: 0.1 }) === 3);

  // The property the readout, keyframe snapping and the playback loop all silently rely
  // on. This is where float error bites: 12/12*12 is 11.999999999999998.
  ok('frame -> time -> frame is exact for every rate', (() => {
    for (const fps of [1, 8, 12, 24, 25, 30, 60]) {
      const g = { fps, duration: 4 };
      for (let f = 0; f <= frameCount(g); f++) {
        if (frameAt(g, timeOfFrame(g, f)) !== Math.min(f, frameAt(g, g.duration))) return false;
      }
    }
    return true;
  })());
  ok('timeOfFrame clamps both ends', (() => {
    const g = { fps: 25, duration: 2 };
    return timeOfFrame(g, -5) === 0 && timeOfFrame(g, 9999) === 2;
  })());

  const anchor = { frame: 0, wallMs: 1000, fps: 12 };
  ok('one frame at 12fps takes ~83ms', frameAtWall(anchor, 1000 + 83, 36) === 0 &&
    frameAtWall(anchor, 1000 + 84, 36) === 1, `${frameAtWall(anchor, 1084, 36)}`);
  ok('a second advances exactly 12 frames', frameAtWall(anchor, 2000, 36) === 12);
  ok('it wraps at the frame count', frameAtWall(anchor, 1000 + 3000, 36) === 0);
  // Preview and export must visit the same set of times; every exporter writes 0..total-1.
  ok('it never returns `total` (preview visits exactly what the exporters write)', (() => {
    for (let ms = 0; ms < 6000; ms += 7) if (frameAtWall(anchor, 1000 + ms, 36) >= 36) return false;
    return true;
  })());
  ok('a 500ms stall skips rather than replaying', frameAtWall(anchor, 1500, 36) === 6);
  ok('a clock that went backwards clamps to the anchor', frameAtWall(anchor, 0, 36) === 0);
  ok('a single-frame loop never advances', (() => {
    for (const ms of [0, 100, 5000]) if (frameAtWall(anchor, 1000 + ms, 1) !== 0) return false;
    return true;
  })());
  // The regression the anchor exists to prevent: an accumulating dt loop fails this.
  ok('no drift after ten minutes', frameAtWall(anchor, 1000 + 600_000, 36) === (600 * 12) % 36,
    `${frameAtWall(anchor, 601_000, 36)}`);
  ok('...and the answer only depends on elapsed time, not on how it was sampled', (() => {
    // Sampling the same instant via a different anchor frame must agree.
    const a = { frame: 5, wallMs: 0, fps: 24 };
    return frameAtWall(a, 10_000, 1000) === 5 + 240;
  })());
}

// ------------------------------------------------------- saving and reopening
//
// The whole of "don't lose work" that can be checked without a browser. What cannot be
// checked here: IndexedDB itself, and the ref collision `reserveVideoRefs` prevents —
// minting an id needs a real <video>. The pure half of that guard (`videoRefSeq`) is
// covered below, and the collision is what the reserve call is written to make impossible
// rather than unlikely.
sec('project: clip references');
{
  const project = require(D + '/domain/project.js');
  const sources = require(D + '/domain/sources.js');
  const { konst } = params;

  const layer = (over) => ({
    id: 'layer-1', name: 'L', visible: true, mode: 'halftone',
    opacity: konst(1), blendMode: 'source-over', spawn: { kind: 'full' },
    params: {}, morph: null, ...over,
  });
  // v2 shape: ONE source on the scene, not one per layer.
  const scene = (layers, source) => ({
    width: 1920, height: 1080, fps: 25, duration: 4, background: '#fff',
    source: source ?? { image: null, srcTime: konst(0) }, layers,
  });
  const srcScene = (image, layers) => scene(layers ?? [layer({})], { image, srcTime: konst(0) });

  ok('a data URL is not a clip reference', !sources.isVideoRef('data:image/png;base64,AAA'));
  ok('a clip reference is', sources.isVideoRef('video:3'));
  ok('videoRefSeq reads the number', sources.videoRefSeq('video:12') === 12);
  ok('videoRefSeq rejects a non-ref rather than returning NaN', sources.videoRefSeq('data:x') === 0);

  // Several layers, one source: the whole point of the move. The refs come off the scene,
  // so no number of layers or morphs can add or hide one.
  const withClip = srcScene('video:2', [
    layer({ params: { cell: konst(8) } }),
    layer({ id: 'layer-2', mode: 'ascii',
      morph: { mode: 'halftone', params: {}, start: 1, end: 2,
               style: 'dissolve', easeOut: 'cubic', easeIn: 'cubic' } }),
  ]);
  ok('finds the scene clip once, however many layers screen it',
    JSON.stringify(project.collectClipRefs(withClip)) === '["video:2"]');
  ok('a still image is not reported as a clip',
    project.collectClipRefs(srcScene('data:image/png;base64,AAA')).length === 0);
  ok('no source at all reports nothing', project.collectClipRefs(scene([layer({})])).length === 0);
  // A v1 scene has its ref down in a layer's params. collectClipRefs deliberately does NOT
  // look there — `migrateScene` is what has to run first, and `applyProject` depends on it.
  ok('a stale layer-level image is NOT mistaken for the scene source',
    project.collectClipRefs(scene([layer({ params: { image: konst('video:7') } })])).length === 0);

  sec('project: re-linking rewrites the scene');
  {
    // Re-registering a file mints a NEW id, so a re-link can never be an assignment back
    // onto the saved reference — it has to rewrite the scene.
    const out = project.remapClipRef(withClip, 'video:2', 'video:20');
    ok('the scene source moved', out.source.image === 'video:20');
    ok('the layers are untouched', out.layers === withClip.layers);
    ok('nothing matched -> the same object back (no undo churn)',
      project.remapClipRef(withClip, 'video:404', 'video:1') === withClip);
    ok('re-linking to itself is also a no-op',
      project.remapClipRef(withClip, 'video:2', 'video:2') === withClip);
  }

  sec('project: a version-1 file brings its source forward');
  {
    // v1 kept `image`/`srcTime` in every layer's params. Dropping them on load would lose
    // the user's uploaded picture, which is the worst thing this loader could do.
    const v1 = scene([
      layer({ params: { image: konst('video:3'), srcTime: konst(2.5), cell: konst(8) } }),
      layer({ id: 'layer-2', params: { image: konst('video:9') } }),
    ]);
    delete v1.source;
    const up = project.migrateScene(v1);
    ok('the source is hoisted onto the scene', up.source.image === 'video:3');
    ok('...with its clip offset', up.source.srcTime.value === 2.5);
    ok('...and is then findable as a clip reference',
      JSON.stringify(project.collectClipRefs(up)) === '["video:3"]');
    ok('the keys are stripped from every layer, not left to ride along in future saves',
      up.layers.every((l) => !('image' in l.params) && !('srcTime' in l.params)));
    ok('other params survive', up.layers[0].params.cell.value === 8);
    // Bottom-up is paint order, so the first one found is the picture that was underneath.
    ok('a file naming several sources takes the bottom layer\'s', up.source.image !== 'video:9');

    const v1morph = scene([layer({
      params: {},
      morph: { mode: 'ascii', params: { image: konst('video:4'), srcTime: konst(1) },
               start: 1, end: 2, style: 'dissolve', easeOut: 'cubic', easeIn: 'cubic' },
    })]);
    delete v1morph.source;
    const upm = project.migrateScene(v1morph);
    ok('a source that only existed on a morph target is found too', upm.source.image === 'video:4');
    ok('...and stripped from the morph params', !('image' in upm.layers[0].morph.params));

    const v1none = scene([layer({})]);
    delete v1none.source;
    ok('a v1 file with no source at all gets an empty one',
      project.migrateScene(v1none).source.image === null);
    ok('migrating is idempotent — a current scene passes through untouched',
      project.migrateScene(withClip) === withClip);
    ok('a v1 file loads through parseProject, source and all',
      project.parseProject(JSON.stringify(
        { format: 'glyph-grid-studio', version: 1, scene: v1 })).scene.source.image === 'video:3');
  }

  sec('project: save and reopen');
  {
    const info = { ref: 'video:2', name: 'beach.mp4', width: 1920, height: 1080, duration: 12.5 };
    const doc = project.makeProject('My comp', withClip, (r) => (r === 'video:2' ? info : null), 1000);
    const back = project.parseProject(project.projectToJSON(doc));
    ok('round-trips the scene exactly', JSON.stringify(back.scene) === JSON.stringify(withClip));
    ok('round-trips the name', back.name === 'My comp');
    ok('carries the clip manifest', back.clips.length === 1 && back.clips[0].name === 'beach.mp4');

    // The save → reload → save cycle. The clip is gone, so nothing can describe it; if the
    // second save dropped the reference the project would stop being re-linkable, and if it
    // dropped the NAME the person would lose the only clue about which file to find.
    const known = new Map(back.clips.map((c) => [c.ref, c]));
    const again = project.makeProject('My comp', back.scene, (r) => known.get(r) ?? null, 2000);
    ok('re-saving without the clip keeps the reference', again.clips.length === 1);
    ok('...and keeps its name', again.clips[0].name === 'beach.mp4');

    const orphan = project.makeProject('x', withClip, () => null, 0);
    ok('a reference nothing can describe still travels', orphan.clips[0].ref === 'video:2');
    ok('...labelled as unknown rather than dropped', orphan.clips[0].name === 'Unknown clip');
  }

  sec('project: what is missing after a reload');
  {
    const known = [{ ref: 'video:2', name: 'beach.mp4', width: 1920, height: 1080, duration: 12.5 }];
    const gone = project.missingClips(withClip, known, () => false);
    ok('lists the clip that is not loaded', gone.length === 1);
    // The regression this exists to prevent: naming it from live state instead of the saved
    // manifest gives "Unknown clip", which is precisely the information the user needs.
    ok('names it from the manifest, not from live state', gone[0].name === 'beach.mp4');
    ok('describes it well enough to go and find it', gone[0].duration === 12.5 && gone[0].width === 1920);
    ok('a loaded clip is not listed', project.missingClips(withClip, known, () => true).length === 0);
    ok('a reference with no manifest entry still lists',
      project.missingClips(withClip, [], () => false)[0].name === 'Unknown clip');
  }

  sec('project: refusing a file, readably');
  {
    const refuses = (input, fragment) => {
      try { project.parseProject(input); return false; }
      catch (e) { return e instanceof project.ProjectParseError && e.message.includes(fragment); }
    };
    ok('not JSON at all', refuses('<html>', 'may not be a .ggs'));
    ok('JSON, but not ours', refuses('{"hello":1}', "isn't a Glyph Grid Studio project"));
    // Someone will open the After Effects export here. Naming which file they picked beats
    // "not a project".
    ok('the coordinates export is identified by name',
      refuses(JSON.stringify({ width: 1920, height: 1080, items: [] }), 'coordinates export'));
    ok('a newer format says so rather than half-loading',
      refuses(JSON.stringify({ format: 'glyph-grid-studio', version: 99, scene: withClip }), 'newer version'));
    ok('no layers', refuses(JSON.stringify(
      { format: 'glyph-grid-studio', version: 1, scene: scene([]) }), 'no layers'));
    ok('no canvas size', refuses(JSON.stringify(
      { format: 'glyph-grid-studio', version: 1, scene: { fps: 25, duration: 4, layers: [layer({})] } }),
      'canvas size'));
    ok('a layer missing its settings names the layer',
      refuses(JSON.stringify({ format: 'glyph-grid-studio', version: 1,
        scene: scene([{ id: 'a', mode: 'ascii', opacity: konst(1) }]) }), 'Layer 1'));
    ok('an older format still opens', project.parseProject(JSON.stringify(
      { format: 'glyph-grid-studio', version: 0, scene: withClip })).scene.layers.length === 2);
    ok('a missing name falls back rather than throwing', project.parseProject(JSON.stringify(
      { format: 'glyph-grid-studio', version: 1, scene: withClip })).name === 'Untitled');
  }

  sec('project: filenames');
  {
    ok('spaces become hyphens', project.projectFileName('My Comp') === 'My-Comp.ggs');
    ok('slashes cannot escape the filename', project.projectFileName('a/../b') === 'ab.ggs');
    ok('an empty name still produces a file', project.projectFileName('   ') === 'untitled.ggs');
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
