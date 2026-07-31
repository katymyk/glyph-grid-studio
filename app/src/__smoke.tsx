/**
 * Headless smoke test. Not part of the app bundle — built separately:
 *   ./node_modules/.bin/vite build --ssr src/__smoke.tsx --outDir .smoke && node .smoke/__smoke.js
 * It exercises the React tree, the store and the engine together, which is the only
 * way to catch runtime faults (a missing param, a registry cycle) without a browser.
 */
import { renderToString } from 'react-dom/server';
import { App } from './App';
import { useStudio } from './state/store';
import { getMode, listModes } from './engine/modes';
import { resolveScene } from './engine/placements';
import { paintScene } from './engine/paint';
import { sceneToSVG } from './engine/export/svg';
import { sceneToJSON } from './engine/export/json';
import { konst } from './domain/params';
import { primeImage, primeSample, sampleSource } from './engine/imageSample';
import { beginSourceProbe, sourcePending } from './engine/sourceReady';
import { clipMs, isVideoRef, videoInfo, type VideoInfo } from './engine/videoSource';
import { settleSources } from './engine/export/frames';
import { mp4Supported, MP4_UNSUPPORTED, sceneToMP4 } from './engine/export/mp4';
import type { Scene } from './domain/scene';

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`);
  }
};
const sec = (s: string) => console.log(`\n== ${s}`);

/** zustand v5 feeds renderToString from getInitialState(), not the live state, so the
    live state has to be mirrored across before rendering. */
function render(): string {
  Object.assign(useStudio.getInitialState(), useStudio.getState());
  // React inserts <!-- --> separators between text nodes; strip them before matching.
  return renderToString(<App />).replace(/<!--\s*-->/g, '');
}

const s = () => useStudio.getState();

// ------------------------------------------------------------------- registry
sec('mode registry');
ok('all four modes registered', JSON.stringify(listModes().map((m) => m.key)) ===
  JSON.stringify(['generative', 'ascii', 'particle', 'halftone']),
  listModes().map((m) => m.key).join(','));
ok('getMode("halftone") resolves (no import cycle)', (() => {
  try {
    return getMode('halftone').label === 'Halftone';
  } catch {
    return false;
  }
})());
ok('halftone declares palette and seed (the panels dereference these)', (() => {
  const p = getMode('halftone').defaultParams();
  return 'palette' in p && 'seed' in p;
})());
ok('halftone declares image + srcTime (source panel + video seam)', (() => {
  const p = getMode('halftone').defaultParams();
  return 'image' in p && 'srcTime' in p;
})());
// Both source-reading modes must carry srcTime, or the Clip panel dereferences a param
// that mode doesn't declare and the slider silently binds to nothing.
ok('ascii declares image + srcTime too', (() => {
  const p = getMode('ascii').defaultParams();
  return 'image' in p && 'srcTime' in p;
})());

// --------------------------------------------------------------- render tree
sec('render the app with a halftone layer selected');
const id = s().scene.layers[0].id;
s().setLayerMode(id, 'halftone');
ok('layer mode switched', s().scene.layers[0].mode === 'halftone');
let html = '';
ok('renderToString does not throw', (() => {
  try {
    html = render();
    return true;
  } catch (e) {
    console.log('      ' + (e as Error).message);
    return false;
  }
})());
ok('sidebar shows the Halftone mode button', html.includes('Halftone'));
ok('sidebar shows the Source panel', html.includes('Source'));
ok('no source yet -> the empty-source copy is shown', html.includes('No source yet'));
ok('dot-screen controls are present under algo=halftone', html.includes('Screen angle'),
  html.includes('Screen angle') ? '' : 'missing');
ok('pixel-size control is hidden under algo=halftone', !html.includes('Pixel size'));
ok('no image -> zero placements', resolveScene(s().scene, 0)[0].placements.length === 0);

sec('conditional visibility follows algo');
s().setConstParam(id, 'algo', 'floyd');
html = render();
ok('screen angle disappears under floyd', !html.includes('Screen angle'));
ok('pixel size appears under floyd', html.includes('Pixel size'));
ok('serpentine appears under floyd', html.includes('Serpentine'));
ok('grain stays hidden under floyd', !html.includes('Grain spread'));
s().setConstParam(id, 'algo', 'noise');
html = render();
ok('grain appears under noise', html.includes('Grain spread'));
ok('serpentine hidden under noise', !html.includes('Serpentine'));
s().setConstParam(id, 'algo', 'halftone');

sec('the element-cap readout');
/** The text of the readout element, isolated from the rest of the sidebar. */
const readoutText = (h: string): string => {
  const m = h.match(/Actual<\/span><span[^>]*>([^<]*)</);
  return m ? m[1] : '';
};
html = render();
ok('readout renders its label', html.includes('Actual'));
// The readout text carries spaces, punctuation and a thousands separator, and the
// panel selector packs every field into ONE string — so a printable delimiter would
// mis-split it and shift readouts onto the wrong control.
ok('readout survives the field packing intact (spaces, ·, thousands separator)',
  /^[\d.]+px · up to [\d,]+ dots$/.test(readoutText(html)), JSON.stringify(readoutText(html)));
// The DEFAULT cell must run uncapped, or the mode silently ignores its own settings.
ok('the default cell is not capped', !readoutText(html).includes('capped'),
  JSON.stringify(readoutText(html)));
s().setConstParam(id, 'cell', 3);
html = render();
ok('going finer than the default IS capped, and says so',
  /^3 → [\d.]+px · up to [\d,]+ dots \(capped\)$/.test(readoutText(html)),
  JSON.stringify(readoutText(html)));
s().setConstParam(id, 'cell', 8);
s().setConstParam(id, 'algo', 'floyd');
html = render();
ok('the readout switches to cells for a dither algo',
  /cells before merging|cells \(capped\)/.test(readoutText(html)),
  JSON.stringify(readoutText(html)));
ok('the default pixel size is not capped either', !readoutText(html).includes('capped'),
  JSON.stringify(readoutText(html)));
s().setConstParam(id, 'algo', 'halftone');
html = render();
ok('an uncapped cell is not labelled capped', !readoutText(html).includes('capped'));

// ------------------------------------------------------------------- with art
sec('the no-source path (actual pixel sampling needs a browser)');
const URL_A = 'data:image/png;base64,STUB';
ok('sampleSource(null) is null, not a throw', sampleSource(null, 8, 8, 0, 25) === null);
ok('halftone with no image yields no placements, whatever the algo', (() => {
  for (const algo of ['halftone', 'floyd', 'atkinson', 'bayer4', 'bayer8', 'noise']) {
    const got = getMode('halftone').placements(
      { ...Object.fromEntries(Object.entries(getMode('halftone').defaultParams()).map(
        ([k, p]) => [k, (p as { value: unknown }).value])), algo, image: null },
      { width: 320, height: 180, time: 0, fps: 25 },
    );
    if (got.length !== 0) return false;
  }
  return true;
})());
ok('the frame index is derived from time + srcTime (the video seam)', (() => {
  // srcTime shifts which source frame is asked for; with no image this is inert, but
  // the plumbing must exist for a video source to be retimeable on the timeline.
  const p = getMode('halftone').defaultParams();
  return 'srcTime' in p && (p.srcTime as { value: unknown }).value === 0;
})());
void primeImage;
s().setConstParam(id, 'image', null);

// ------------------------------------------------------------------ video sources
sec('video refs (decoding needs a browser; routing and timing do not)');
ok('a video ref is recognised, a data URL is not',
  isVideoRef('video:1') && !isVideoRef(URL_A) && !isVideoRef(null) && !isVideoRef(7));
ok('an unregistered ref samples to null rather than throwing',
  sampleSource('video:404', 8, 8, 0, 25) === null);
// If a dead ref counted as pending, every export would spin out its retry budget on a
// clip that is never coming back.
ok('an unregistered ref is NOT pending (an export must not wait for it forever)', (() => {
  beginSourceProbe();
  sampleSource('video:404', 8, 8, 0, 25);
  return sourcePending() === 0;
})());
ok('an undecoded image IS pending (an export must wait for it)', (() => {
  beginSourceProbe();
  try {
    sampleSource('data:image/png;base64,NOTDECODED', 8, 8, 0, 25);
  } catch {
    // node has no `Image` to kick the decode off with. Irrelevant to what is being
    // asserted: pending is raised BEFORE any decode work, which is the contract — an
    // export must not be able to observe a not-ready source as ready.
  }
  return sourcePending() === 1;
})());
ok('a primed sample is a hit, so it is not pending', (() => {
  const g = { cols: 4, rows: 4, lum: new Float32Array(16), rgb: new Uint8ClampedArray(48),
    alpha: new Uint8ClampedArray(16).fill(255) };
  primeSample('primed://x', g);
  beginSourceProbe();
  const got = sampleSource('primed://x', 4, 4, 0, 25);
  return got === g && sourcePending() === 0;
})());
ok('videoInfo on an unknown ref is null', videoInfo('video:404') === null);

sec('clip timing: frame index -> position in the clip');
{
  const clip: VideoInfo = { ref: 'video:1', name: 'c.mp4', width: 640, height: 360, duration: 3 };
  ok('frame 0 is the start', clipMs(clip, 0, 25) === 0);
  ok('frame 25 @25fps is one second in', clipMs(clip, 25, 25) === 1000);
  ok('the same second is the same position at another frame rate',
    clipMs(clip, 30, 30) === clipMs(clip, 25, 25));
  // A short clip on a long timeline holds rather than blanking, and every held frame
  // resolves to ONE position — so the tail of a 10s comp costs one decode, not 175.
  const tail = clipMs(clip, 250, 25);
  ok('past the end the last frame is held', tail > 2900 && tail < 3000, `${tail}ms`);
  ok('the whole held tail is one cache position', clipMs(clip, 400, 25) === tail);
  ok('it never seeks exactly to duration (which can decode nothing)', tail < 3000);
  ok('a negative offset clamps to the start', clipMs(clip, -50, 25) === 0);
  ok('an unknown-length clip pins to the start rather than guessing',
    clipMs({ ...clip, duration: 0 }, 90, 25) === 0);
}

sec('the Clip panel appears only for a video source');
{
  const st = useStudio.getState();
  st.reset();
  const lid = useStudio.getState().scene.layers[0].id;
  st.setLayerMode(lid, 'halftone');
  st.setConstParam(lid, 'image', URL_A);
  ok('an image source shows no Source time slider', !render().includes('Source time'));
  st.setConstParam(lid, 'image', 'video:1');
  ok('a video source shows it', render().includes('Source time'));
  st.setLayerMode(lid, 'ascii');
  ok('and in ascii mode too', render().includes('Source time'));
  st.reset();
}

// Feed placements directly to prove the painter/exporters handle every shape.
sec('painter + exporters over each shape');
function sceneOf(bg: string | null): Scene {
  const base = s().scene;
  return {
    ...base,
    background: bg,
    layers: [
      {
        id: 'L',
        name: 'L',
        visible: true,
        mode: 'halftone',
        opacity: konst(1),
        blendMode: 'source-over',
        spawn: { kind: 'full' },
        params: {},
        morph: null,
      },
    ],
  } as Scene;
}
/** Records the 2D-context calls the painter makes. */
function stubCtx() {
  const calls: string[] = [];
  const rec =
    (name: string) =>
    (...a: unknown[]) => {
      calls.push(`${name}(${a.map((v) => (typeof v === 'number' ? +v.toFixed(1) : String(v))).join(',')})`);
    };
  const ctx: Record<string, unknown> = {
    calls,
    save: rec('save'),
    restore: rec('restore'),
    clearRect: rec('clearRect'),
    fillRect: rec('fillRect'),
    fillText: rec('fillText'),
    beginPath: rec('beginPath'),
    rect: rec('rect'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    arc: rec('arc'),
    ellipse: rec('ellipse'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    translate: rec('translate'),
    rotate: rec('rotate'),
  };
  Object.defineProperty(ctx, 'font', { set: (v) => calls.push(`font=${v}`), get: () => '' });
  return ctx as unknown as CanvasRenderingContext2D & { calls: string[] };
}

const SHAPES = ['dot', 'square', 'diamond', 'line', 'cross', 'ring', 'pixel'] as const;
for (const shape of SHAPES) {
  const sc = sceneOf('#ffffff');
  const mode = getMode('halftone');
  const orig = mode.placements;
  mode.placements = () => [
    { shape, x: 100, y: 50, w: 10, h: 10, color: '#111111', rotation: 0, alpha: 1 },
    { shape, x: 130, y: 50, w: 10, h: 10, color: '#111111', rotation: 0, alpha: 1 },
  ];
  const ctx = stubCtx();
  const drawn = paintScene(ctx, sc, 0);
  const svg = sceneToSVG(sc, 0);
  const json = JSON.parse(sceneToJSON(sc, 0));
  ok(`${shape}: painter draws both, emits no fillText`,
    drawn === 2 && !ctx.calls.some((c) => c.startsWith('fillText')));
  ok(`${shape}: svg emits an element and no <text>`, svg.includes('/>') && !svg.includes('<text'));
  ok(`${shape}: json carries shape + w/h, no glyph`, (() => {
    const it = json.layers[0].items[0];
    return it.shape === shape && typeof it.w === 'number' && it.glyph === undefined;
  })());
  mode.placements = orig;
}

sec('glyph placements still behave (no regression)');
{
  const sc = sceneOf('#ffffff');
  const mode = getMode('halftone');
  const orig = mode.placements;
  mode.placements = () => [
    { x: 10, y: 20, size: 24, glyph: 'A', color: '#000', rotation: 0, alpha: 1, weight: '400', font: 'mono' },
  ];
  const ctx = stubCtx();
  paintScene(ctx, sc, 0);
  ok('glyph path assigns ctx.font and calls fillText',
    ctx.calls.some((c) => c.startsWith('font=')) && ctx.calls.some((c) => c.startsWith('fillText')));
  const svg = sceneToSVG(sc, 0);
  ok('glyph exports as <text>', svg.includes('<text'));
  const it = JSON.parse(sceneToJSON(sc, 0)).layers[0].items[0];
  ok('glyph json keeps size + glyph', it.shape === 'glyph' && it.glyph === 'A' && it.size === 24);
  mode.placements = orig;
}

sec('mixed shapes in one layer (an ascii<->halftone morph)');
{
  const sc = sceneOf('#ffffff');
  const mode = getMode('halftone');
  const orig = mode.placements;
  mode.placements = () => [
    { x: 10, y: 20, size: 24, glyph: 'A', color: '#000', rotation: 0, alpha: 1, weight: '400', font: 'mono' },
    { shape: 'dot', x: 40, y: 20, w: 8, h: 8, color: '#000', rotation: 0, alpha: 1 },
  ];
  const svg = sceneToSVG(sc, 0);
  ok('one <g> holds both <text> and <circle>', svg.includes('<text') && svg.includes('<circle'));
  ok('crispEdges is NOT hoisted for a mixed layer', !svg.includes('shape-rendering="crispEdges"'));
  const ctx = stubCtx();
  ok('painter draws both', paintScene(ctx, sc, 0) === 2);
  mode.placements = orig;
}

sec('transparent background end to end');
{
  const mode = getMode('halftone');
  const orig = mode.placements;
  mode.placements = () => [
    { shape: 'dot', x: 40, y: 20, w: 8, h: 8, color: '#000', rotation: 0, alpha: 1 },
  ];
  const clear = sceneOf(null);
  const ctxT = stubCtx();
  paintScene(ctxT, clear, 0);
  const full = `fillRect(0,0,${clear.width},${clear.height})`;
  ok('canvas: clears and never fills a background rect',
    ctxT.calls.some((c) => c.startsWith('clearRect')) && !ctxT.calls.includes(full));
  ok('svg: no background rect when background is null',
    !sceneToSVG(clear, 0).includes(`<rect width="${clear.width}"`));
  ok('json: records background null', JSON.parse(sceneToJSON(clear, 0)).background === null);
  const opaque = sceneOf('#ffffff');
  const ctxO = stubCtx();
  paintScene(ctxO, opaque, 0);
  ok('canvas: fills the background rect when opaque', ctxO.calls.includes(full));
  ok('svg: emits exactly one background rect when opaque',
    sceneToSVG(opaque, 0).split(`<rect width="${opaque.width}"`).length === 2);
  mode.placements = orig;
}

sec('pixel runs hoist crispEdges');
{
  const mode = getMode('halftone');
  const orig = mode.placements;
  mode.placements = () => [
    { shape: 'pixel', x: 10, y: 5, w: 20, h: 4, color: '#000', rotation: 0, alpha: 1 },
    { shape: 'pixel', x: 40, y: 5, w: 20, h: 4, color: '#000', rotation: 0, alpha: 1 },
  ];
  const sc = sceneOf('#fff');
  const svg = sceneToSVG(sc, 0);
  ok('crispEdges hoisted to the <g> for an all-pixel layer',
    svg.includes('shape-rendering="crispEdges"') &&
      svg.split('shape-rendering="crispEdges"').length === 2);
  ok('fill hoisted for a monochrome layer', svg.includes('<g opacity="1" fill="#000"'));
  mode.placements = orig;
}

// ------------------------------------------------------------------ store
sec('store behaviour');
{
  const st = useStudio.getState();
  st.reset();
  const lid = useStudio.getState().scene.layers[0].id;
  st.setLayerMode(lid, 'ascii');
  st.setConstParam(lid, 'image', URL_A);
  st.setConstParam(lid, 'srcTime', 4.5);
  st.setLayerMode(lid, 'halftone');
  const img = useStudio.getState().scene.layers[0].params.image;
  ok('ascii -> halftone carries the image over',
    img !== undefined && (img as { value?: unknown }).value === URL_A);
  // Where you are in a clip belongs to the source, so a trim must survive a mode switch.
  ok('...and carries the clip offset with it',
    (useStudio.getState().scene.layers[0].params.srcTime as { value?: unknown })?.value === 4.5);

  st.setMorphMode(lid, 'ascii');
  const m = useStudio.getState().scene.layers[0].morph;
  ok('morph target inherits the image too',
    !!m && (m.params.image as { value?: unknown }).value === URL_A);
  st.setMorphMode(lid, null);

  const before = JSON.stringify(useStudio.getState().scene.layers[0].params.image);
  st.surprise();
  ok('surprise changes halftone params', (() => {
    const p = useStudio.getState().scene.layers[0].params;
    const d = getMode('halftone').defaultParams();
    return JSON.stringify(p.cell) !== JSON.stringify(d.cell) ||
      JSON.stringify(p.angle) !== JSON.stringify(d.angle) ||
      JSON.stringify(p.algo) !== JSON.stringify(d.algo);
  })());
  ok('surprise leaves the image alone',
    JSON.stringify(useStudio.getState().scene.layers[0].params.image) === before);

  st.reset();
  ok('reset restores the default generative scene',
    useStudio.getState().scene.layers[0].mode === 'generative');
}

sec('timeline rows for halftone params');
{
  const st = useStudio.getState();
  const lid = useStudio.getState().scene.layers[0].id;
  st.setLayerMode(lid, 'halftone');
  st.toggleParamAnimated(lid, 'cell', 0);
  st.toggleParamAnimated(lid, 'algo', 0);
  const p = useStudio.getState().scene.layers[0].params;
  ok('cell became keyframed', (p.cell as { kind: string }).kind === 'keys');
  ok('algo became keyframed', (p.algo as { kind: string }).kind === 'keys');
  const out = render();
  ok('timeline labels the rows, not raw keys',
    out.includes('Cell size') && out.includes('Algorithm') && !/>cell</.test(out));
  st.reset();
}

// ------------------------------------------- regressions found in review
sec('REGRESSION: canvas and SVG must composite identically when alpha < 1');
{
  const mode = getMode('halftone');
  const orig = mode.placements;
  // A half-faded layer of overlapping dots, as a morph fade produces.
  mode.placements = () => [
    { shape: 'dot', x: 40, y: 20, w: 20, h: 20, color: '#000', rotation: 0, alpha: 0.5 },
    { shape: 'dot', x: 50, y: 20, w: 20, h: 20, color: '#000', rotation: 0, alpha: 0.5 },
  ];
  const sc = sceneOf('#ffffff');
  const svg = sceneToSVG(sc, 0);
  // The painter batches these into ONE path, so their overlap composites once. The SVG
  // must therefore carry the shared alpha on the <g>, not on each circle — otherwise
  // the overlap darkens on export but not on screen.
  ok('a uniform alpha is hoisted onto the <g>', svg.includes('<g opacity="0.5"'),
    (svg.match(/<g [^>]*>/) ?? [''])[0]);
  ok('per-element opacity is then omitted', !svg.includes('<circle') || !/circle[^>]*opacity=/.test(svg));
  const ctxB = stubCtx();
  paintScene(ctxB, sc, 0);
  ok('the painter batches them into a single fill',
    ctxB.calls.filter((c) => c === 'fill()').length === 1,
    `${ctxB.calls.filter((c) => c === 'fill()').length} fills`);

  // Mixed alphas cannot be hoisted, so they stay per-element.
  mode.placements = () => [
    { shape: 'dot', x: 40, y: 20, w: 20, h: 20, color: '#000', rotation: 0, alpha: 0.5 },
    { shape: 'dot', x: 50, y: 20, w: 20, h: 20, color: '#000', rotation: 0, alpha: 0.9 },
  ];
  const svg2 = sceneToSVG(sceneOf('#ffffff'), 0);
  ok('mixed alphas stay per-element', /circle[^>]*opacity="0.5"/.test(svg2) && svg2.includes('<g opacity="1"'));
  mode.placements = orig;
}

sec('REGRESSION: cross draws as one path, not two overlapping fills');
{
  const mode = getMode('halftone');
  const orig = mode.placements;
  mode.placements = () => [
    { shape: 'cross', x: 40, y: 20, w: 20, h: 6, color: '#000', rotation: 0, alpha: 0.5 },
  ];
  const ctxC = stubCtx();
  const bg = sceneOf('#ffffff');
  paintScene(ctxC, bg, 0);
  // Ignore the one fillRect that paints the scene background.
  const bgFill = `fillRect(0,0,${bg.width},${bg.height})`;
  const marks = ctxC.calls.filter((c) => c !== bgFill);
  ok('cross uses rect()+rect()+one fill (no double-composited core)',
    marks.filter((c) => c.startsWith('rect(')).length === 2 &&
      marks.filter((c) => c === 'fill()').length === 1 &&
      !marks.some((c) => c.startsWith('fillRect(')),
    marks.join(' '));
  mode.placements = orig;
}

sec('REGRESSION: layer blend mode reaches the SVG');
{
  const mode = getMode('halftone');
  const orig = mode.placements;
  mode.placements = () => [
    { shape: 'dot', x: 40, y: 20, w: 8, h: 8, color: '#000', rotation: 0, alpha: 1 },
  ];
  const base = sceneOf('#ffffff');
  const mult = { ...base, layers: [{ ...base.layers[0], blendMode: 'multiply' as GlobalCompositeOperation }] };
  ok('multiply becomes mix-blend-mode', sceneToSVG(mult, 0).includes('mix-blend-mode:multiply'));
  const odd = { ...base, layers: [{ ...base.layers[0], blendMode: 'source-in' as GlobalCompositeOperation }] };
  ok('a mode with no CSS equivalent is left alone, not faked',
    !sceneToSVG(odd, 0).includes('mix-blend-mode'));
  ok('normal blending adds nothing', !sceneToSVG(base, 0).includes('mix-blend-mode'));
  mode.placements = orig;
}

sec('REGRESSION: json applies the same culls as canvas and SVG');
{
  const mode = getMode('halftone');
  const orig = mode.placements;
  mode.placements = () => [
    { shape: 'dot', x: 10, y: 10, w: 8, h: 8, color: '#000', rotation: 0, alpha: 1 },
    { shape: 'dot', x: 20, y: 10, w: 0, h: 0, color: '#000', rotation: 0, alpha: 1 }, // zero extent
    { shape: 'dot', x: 30, y: 10, w: 8, h: 8, color: '#000', rotation: 0, alpha: 0.001 }, // invisible
  ];
  const sc = sceneOf('#ffffff');
  const items = JSON.parse(sceneToJSON(sc, 0)).layers[0].items;
  const ctxJ = stubCtx();
  const drawn = paintScene(ctxJ, sc, 0);
  const svgCircles = (sceneToSVG(sc, 0).match(/<circle/g) ?? []).length;
  ok('json item count matches what the canvas drew and the SVG emitted',
    items.length === 1 && drawn === 1 && svgCircles === 1,
    `json ${items.length}, canvas ${drawn}, svg ${svgCircles}`);
  mode.placements = orig;
}

sec('REGRESSION: wide pixel runs are clipped to the spawn zone, not point-tested');
{
  const mode = getMode('halftone');
  const orig = mode.placements;
  const base = sceneOf('#ffffff');
  const W = base.width;
  // A full-width run per row: point-testing its centre would keep or drop the whole bar.
  mode.placements = () => [
    { shape: 'pixel', x: W / 2, y: 100, w: W, h: 10, color: '#000', rotation: 0, alpha: 1 },
  ];
  // Fake an image mask whose left half is white (inside) and right half black.
  const maskUrl = 'mask://left-half';
  const half = {
    cols: 200,
    rows: Math.max(1, Math.round((200 * base.height) / W)),
    lum: new Float32Array(0),
    rgb: new Uint8ClampedArray(0),
    alpha: new Uint8ClampedArray(0),
  };
  half.lum = new Float32Array(half.cols * half.rows);
  half.rgb = new Uint8ClampedArray(half.cols * half.rows * 3);
  half.alpha = new Uint8ClampedArray(half.cols * half.rows).fill(255);
  for (let r = 0; r < half.rows; r++) {
    for (let c = 0; c < half.cols; c++) half.lum[r * half.cols + c] = c < half.cols / 2 ? 1 : 0;
  }
  primeSample(maskUrl, half);
  const masked = {
    ...base,
    layers: [{ ...base.layers[0], spawn: { kind: 'image' as const, image: maskUrl, invert: false } }],
  };
  const got = resolveScene(masked, 0)[0].placements as { x: number; w: number }[];
  ok('the run is clipped rather than kept whole or dropped',
    got.length === 1 && got[0].w > W * 0.4 && got[0].w < W * 0.6,
    got.map((p) => `w=${p.w.toFixed(0)}`).join(','));
  ok('the surviving piece sits in the masked-in half',
    got.length === 1 && got[0].x < W / 2 + 1,
    got.length ? `x=${got[0].x.toFixed(0)}` : 'none');
  mode.placements = orig;
}

sec('REGRESSION: switching modes must not resurrect a stale image');
{
  const st = useStudio.getState();
  st.reset();
  const lid = useStudio.getState().scene.layers[0].id;
  const val = () =>
    (useStudio.getState().scene.layers[0].params.image as { value?: unknown } | undefined)?.value;
  st.setLayerMode(lid, 'halftone');
  st.setConstParam(lid, 'image', 'AAA');
  st.setLayerMode(lid, 'ascii');
  ok('the image follows the layer into the new mode', val() === 'AAA');
  st.setConstParam(lid, 'image', 'BBB'); // replace it while in ascii
  st.setLayerMode(lid, 'halftone');
  ok('switching back keeps the NEWER image, not the one halftone remembered',
    val() === 'BBB', String(val()));
  st.setLayerMode(lid, 'ascii');
  ok('and forward again still keeps it', val() === 'BBB', String(val()));
  st.reset();
}

// ------------------------------------------------- export readiness (async)
/** The build target has no top-level await, so the async checks live in here and the
    summary is printed after they finish. */
async function asyncChecks(): Promise<void> {
  sec('exports settle their sources before writing a frame');
  {
    const st = useStudio.getState();
    st.reset();
    const lid = useStudio.getState().scene.layers[0].id;

    ok('a scene with no source settles at once', await settleSources(useStudio.getState().scene, 0));

    st.setLayerMode(lid, 'halftone');
    st.setConstParam(lid, 'image', 'video:404');
    // A dead ref is not pending, so this must return promptly rather than burn the retry
    // budget: an export of a scene whose clip is gone should finish, not hang.
    ok('a scene whose clip is gone still settles (no hang)',
      await settleSources(useStudio.getState().scene, 0));
    st.reset();
  }

  sec('MP4 export degrades honestly without WebCodecs');
  {
    // node has no VideoEncoder, which is exactly the case a browser without WebCodecs hits.
    ok('mp4Supported() is false here', mp4Supported() === false);
    const msg = await sceneToMP4(useStudio.getState().scene).then(
      () => 'resolved',
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    ok('sceneToMP4 rejects with the explanation the panel shows, not a TypeError',
      msg === MP4_UNSUPPORTED, msg.slice(0, 60));
  }
}

void asyncChecks().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  // node only; declared inline so this file needs no @types/node
  const proc = (globalThis as { process?: { exitCode?: number } }).process;
  if (fail && proc) proc.exitCode = 1;
});
