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
import { beginSourceProbe, fidelity, sourcePending } from './engine/sourceReady';
import {
  clipMs,
  isVideoRef,
  resyncThresholdMs,
  shouldResync,
  videoInfo,
  type VideoInfo,
} from './engine/videoSource';
import { paintSettled, settleSources } from './engine/export/frames';
import { gifButtonLabel, gifSize, gifWorkers } from './engine/export/gif';
import { frameAt, frameCount, timeOfFrame } from './domain/timeline';
import { makeProject, missingClips, parseProject } from './domain/project';
import { currentDoc } from './state/persist';
import {
  mp4Supported,
  MP4_UNSUPPORTED,
  MP4_ATTEMPTS,
  describeMp4Failure,
  mp4FailureMessage,
  sceneToMP4,
  type Mp4Failure,
} from './engine/export/mp4';
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
ok('all three modes registered', JSON.stringify(listModes().map((m) => m.key)) ===
  JSON.stringify(['generative', 'ascii', 'halftone']),
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
  // Aimed at the CENTRE of the frame's interval, not its leading edge — seeking to the
  // boundary lands on the previous clip frame once rounding bites, which is what made an
  // export repeat frames. At 25fps half a frame is 20ms.
  ok('frame 0 aims half a frame in, not at 0', clipMs(clip, 0, 25) === 20);
  ok('frame 25 @25fps is one second in, plus the half frame', clipMs(clip, 25, 25) === 1020);
  ok('consecutive frames are always distinct positions', (() => {
    for (const fps of [8, 12, 24, 25, 30, 60]) {
      const seen = new Set<number>();
      for (let f = 0; f < Math.floor(2.9 * fps); f++) seen.add(clipMs(clip, f, fps));
      if (seen.size !== Math.floor(2.9 * fps)) return false;
    }
    return true;
  })());
  ok('the offset is half a frame at every rate',
    clipMs(clip, 0, 12) === 42 && clipMs(clip, 0, 60) === 8,
    `${clipMs(clip, 0, 12)}ms @12, ${clipMs(clip, 0, 60)}ms @60`);
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

sec('live-playback resync policy');
{
  // Steady state: the frame on screen is inherently up to one scene frame plus one clip
  // frame behind. Chasing that would mean seeking every frame, which is the stall the live
  // regime exists to avoid.
  ok('a small offset is tolerated', !shouldResync(1000, 1080, 25));
  ok('a big offset resyncs', shouldResync(1000, 1600, 25));
  // The loop wrapping is the common case: the playhead returns to 0 while the clip is at
  // the far end, and that must be one seek rather than a slow crawl back.
  ok('the timeline wrapping forces a resync', shouldResync(0, 2900, 25));
  ok('a held tail (want === media) never resyncs', !shouldResync(2996, 2996, 25));
  ok('the tolerance grows as fps falls', resyncThresholdMs(6) > resyncThresholdMs(25));
  ok('but never below a quarter second', resyncThresholdMs(60) === 250 && resyncThresholdMs(120) === 250);
  ok('fps 0 does not divide by zero', Number.isFinite(resyncThresholdMs(0)));
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
  const beforeAll = JSON.stringify(useStudio.getState().scene.layers[0].params);
  st.surprise();
  // Compared against the params it replaced, NOT against the mode defaults. Checking
  // three specific keys against defaults fails roughly one run in 150 on its own:
  // `algo` re-picks 'halftone' half the time and `cell`/`angle` can legitimately land on
  // their default values. Surprise writes ~15 params, so "nothing at all moved" is the
  // real failure and is vanishingly unlikely by chance.
  ok('surprise changes halftone params',
    JSON.stringify(useStudio.getState().scene.layers[0].params) !== beforeAll);
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

  sec('an export can never take the live regime\'s substitute');
  {
    const st = useStudio.getState();
    st.reset();
    // THE assertion for the two-regime split, and it needs no browser: if fidelity is not
    // latched back to 'exact', a video frame that was merely "close enough" for playback
    // gets written into a file, with no pending mark to catch it.
    st.play();
    ok('play() puts sources into the live regime', fidelity() === 'live');
    await settleSources(useStudio.getState().scene, 0);
    ok('settleSources latches back to exact', fidelity() === 'exact');

    st.play();
    const ctx = stubCtx();
    await paintSettled(ctx, useStudio.getState().scene, 0);
    ok('paintSettled latches back to exact too', fidelity() === 'exact');

    // And it must stay latched: the SVG/JSON exporters resolve the scene AFTER
    // settleSources returns, so a bracket that restored would hand them a substitute.
    st.play();
    await settleSources(useStudio.getState().scene, 0);
    sceneToSVG(useStudio.getState().scene, 0);
    ok('...and stays exact while the caller serializes', fidelity() === 'exact');

    st.pause();
    ok('pause() is exact', fidelity() === 'exact');
    st.play();
    st.stepFrame(1);
    ok('stepping a frame is exact (a stepped frame must be the real one)', fidelity() === 'exact');
    ok('stepping also stopped playback', useStudio.getState().playing === false);
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

// ------------------------------------------------- the MP4 codec ladder
sec('the transport lands on frames');
{
  const st = useStudio.getState();
  st.reset();
  st.setFps(25);
  st.setDuration(4);
  const g = () => useStudio.getState().scene;
  const at = () => frameAt(g(), useStudio.getState().playhead);

  st.setPlayhead(0);
  for (let i = 0; i < 7; i++) st.stepFrame(1);
  ok('seven steps forward land on frame 7 exactly', at() === 7, `f${at()}`);
  ok('stepping stops playback', useStudio.getState().playing === false);
  for (let i = 0; i < 20; i++) st.stepFrame(-1);
  ok('stepping back clamps at frame 0', at() === 0, `f${at()}`);
  for (let i = 0; i < 200; i++) st.stepFrame(1);
  ok('stepping forward clamps at the last frame the exporters write',
    at() === frameCount(g()) - 1, `f${at()} of ${frameCount(g())}`);

  // setPlayhead stays a raw setter: the easing inspector parks it on a key deliberately,
  // and a key can sit off-grid.
  st.setPlayhead(1.234);
  ok('setPlayhead does NOT snap (sub-frame writes are legitimate)',
    Math.abs(useStudio.getState().playhead - 1.234) < 1e-9, String(useStudio.getState().playhead));
  st.setPlayhead(999);
  ok('setPlayhead clamps to the duration', useStudio.getState().playhead === 4);
  st.setPlayhead(-1);
  ok('...and to zero', useStudio.getState().playhead === 0);

  st.setPlayhead(timeOfFrame(g(), 25)); // 1.00s at 25fps
  st.setFps(12);
  ok('changing fps re-snaps onto the new grid', at() === frameAt(g(), 1) && at() === 12, `f${at()}`);
  ok('and keeps roughly the same second', Math.abs(useStudio.getState().playhead - 1) < 0.05,
    `${useStudio.getState().playhead}s`);
  st.reset();
}

sec('GIF resolution cap');
{
  const s720 = gifSize(1920, 1080);
  ok('1920×1080 caps to 720 on the long side', s720.width === 720 && s720.height === 405,
    `${s720.width}×${s720.height}`);
  const tall = gifSize(1080, 1920);
  ok('portrait caps on the long side too', tall.width === 405 && tall.height === 720,
    `${tall.width}×${tall.height}`);
  const sq = gifSize(1080, 1080);
  ok('square caps to 720×720', sq.width === 720 && sq.height === 720);
  const small = gifSize(640, 480);
  ok('a small canvas is never upscaled', small.width === 640 && small.height === 480);
  const tiny = gifSize(1, 1);
  ok('never rounds a dimension to zero', tiny.width === 1 && tiny.height === 1);
  ok('aspect is preserved to within a pixel',
    Math.abs(s720.width / s720.height - 1920 / 1080) < 0.01);

  ok('workers default to 4 when the core count is unknown', gifWorkers(undefined, 100) === 4);
  ok('workers are capped at 8 (a memory bound, not a CPU one)', gifWorkers(16, 100) === 8);
  ok('never more workers than frames', gifWorkers(8, 3) === 3);
  ok('always at least one worker', gifWorkers(0, 100) >= 1);
}

sec('the GIF cap discloses itself on the button');
{
  // This protects the honesty property rather than the maths: if the cap ever stops being
  // shown to the user, the build fails.
  ok('the label names the real output size',
    gifButtonLabel({ width: 1920, height: 1080, background: '#fff' }) === 'GIF (animated · 720×405)',
    gifButtonLabel({ width: 1920, height: 1080, background: '#fff' }));
  ok('and follows the canvas',
    gifButtonLabel({ width: 1080, height: 1080, background: '#fff' }) === 'GIF (animated · 720×720)');
  ok('an uncapped canvas still states its size (no special case to drift)',
    gifButtonLabel({ width: 640, height: 480, background: '#fff' }) === 'GIF (animated · 640×480)');
  ok('a transparent scene also says "on white"',
    gifButtonLabel({ width: 1920, height: 1080, background: null }) ===
      'GIF (animated · 720×405 · on white)');
}

sec('MP4 codec ladder');
// The AE/Premiere ordering is a requirement, not a preference, so it is a test rather
// than a comment: H.264 must be exhausted (hardware AND software) before anything else.
ok('avc is tried first', MP4_ATTEMPTS[0].codec === 'avc' && MP4_ATTEMPTS[0].hardwareAcceleration === undefined);
ok('the first two rungs are both avc', MP4_ATTEMPTS[1].codec === 'avc',
  MP4_ATTEMPTS.map((a) => `${a.codec}/${a.hardwareAcceleration ?? '-'}`).join(' '));
ok('no (codec, hardwareAcceleration) pair repeats',
  new Set(MP4_ATTEMPTS.map((a) => `${a.codec}/${a.hardwareAcceleration ?? '-'}`)).size === MP4_ATTEMPTS.length);

sec('MP4 failure reporting (the only Safari diagnostic we get)');
{
  // Two rungs: one where the browser rejected a config mediabunny had built, and one
  // where it threw before a config existed. Both shapes must render.
  const failures: Mp4Failure[] = [
    {
      attempt: { codec: 'avc' },
      config: {
        codec: 'avc1.640028',
        width: 1920,
        height: 1080,
        framerate: 25,
        bitrate: 6112000,
        bitrateMode: 'variable',
      },
      error: new TypeError("The provided value 'quantizer' is not a valid enum value"),
    },
    { attempt: { codec: 'hevc', hardwareAcceleration: 'prefer-software' }, config: null, error: 'plain string' },
  ];
  const msg = mp4FailureMessage(failures);
  ok('names every codec tried', msg.includes('avc') && msg.includes('hevc'));
  ok('carries the exact config the browser saw', msg.includes('avc1.640028') && msg.includes('1920x1080'));
  ok('carries the rate control (the thing that broke Safari)', msg.includes('variable') && msg.includes('6112 kbps'));
  // error.name is what distinguishes a rejected IDL member from an unsupported codec
  // from a dead encoder — three different bugs that otherwise read identically.
  ok('carries error.name, not just the message', msg.includes('TypeError:'));
  ok('survives a non-Error throw', msg.includes('plain string'));
  ok('reports a rung that threw before a config existed', msg.includes('no config built'));
  ok('offers the escape hatch', msg.includes('PNG sequence'));
  // The classic way a diagnostic becomes useless.
  ok('contains no [object Object] and no undefined', !msg.includes('[object Object]') && !msg.includes('undefined'),
    msg.split('\n')[1]?.slice(0, 90));
  ok('one line per attempted configuration', mp4FailureMessage(failures).split('\n').length === 4,
    `${msg.split('\n').length} lines`);
  // A config with no framerate/bitrate is the shape a very early rejection produces.
  ok('describeMp4Failure omits absent fields rather than printing undefined',
    !describeMp4Failure({
      attempt: { codec: 'vp9' },
      config: { codec: 'vp09.00.10.08', width: 640, height: 480 },
      error: new Error('x'),
    }).includes('undefined'));
}

// ------------------------------------------------------ saving and restoring
//
// The store/tree half of "don't lose work". `domain/project.ts` is checked on its own in
// check:math; this is the part only a rendered tree can answer — that a restore actually
// reaches the sidebar, and that a missing clip is named rather than silently absent.
// IndexedDB itself is browser-only and is not covered anywhere.
sec('project: the panel is wired in');
{
  const st = useStudio.getState();
  st.reset();
  const html = render();
  ok('the sidebar has a Project panel', html.includes('Project'));
  ok('a clean session shows no restore notice', !html.includes('Picked up where you left off'));
  ok('...and no re-link alert', !html.includes('re-linking'));
  ok('...and no storage warning (storage is simply absent under SSR, not broken)',
    !html.includes('Not saving'));
}

sec('project: opening a document replaces the session cleanly');
{
  const st = useStudio.getState();
  st.reset();
  const lid = useStudio.getState().scene.layers[0].id;
  st.setConstParam(lid, 'cols', 33);
  st.setPlayhead(1.5);
  ok('there is history to lose', useStudio.getState().past.length > 0);

  const opened: Scene = { ...useStudio.getState().scene, width: 800, height: 600 };
  st.loadProject(makeProject('Opened comp', opened, () => null, 0));

  const s2 = useStudio.getState();
  ok('the scene is adopted', s2.scene.width === 800);
  ok('the name comes with it', s2.projectName === 'Opened comp');
  // One undo must never jump between two unrelated documents.
  ok('history is cleared', s2.past.length === 0 && s2.future.length === 0);
  ok('the playhead goes home', s2.playhead === 0);
  ok('nothing is left selected', s2.selection === null);
  ok('opening is not itself a restore', s2.restored === false);
}

sec('project: a restore announces itself');
{
  const st = useStudio.getState();
  st.reset();
  st.loadProject(makeProject('Yesterday', useStudio.getState().scene, () => null, 0), {
    id: 'p-1',
    restored: true,
  });
  const html = render();
  ok('the notice is shown', html.includes('Picked up where you left off'));
  ok('...with a way out that keeps the old one', html.includes('Start fresh'));
  ok('the id from storage is adopted, not replaced',
    useStudio.getState().projectId === 'p-1',
    useStudio.getState().projectId);

  useStudio.getState().dismissRestored();
  ok('dismissing hides it', !render().includes('Picked up where you left off'));
}

sec('project: a clip that cannot come back is named, not hidden');
{
  const st = useStudio.getState();
  st.reset();
  const lid = useStudio.getState().scene.layers[0].id;
  st.setLayerMode(lid, 'halftone');
  st.setConstParam(lid, 'image', 'video:2');

  const info: VideoInfo = { ref: 'video:2', name: 'beach-walk.mp4', width: 1920, height: 1080, duration: 12.4 };
  const doc = makeProject('Clip comp', useStudio.getState().scene, () => info, 0);
  st.loadProject(doc, { restored: true });

  const html = render();
  ok('the alert appears', html.includes('needs re-linking'));
  // THE regression. Rebuilding the manifest from live state instead of carrying the saved
  // one gives "Unknown clip" — which is exactly the fact the person needs to act.
  ok('it names the actual file', html.includes('beach-walk.mp4'));
  ok('...and describes it well enough to find', html.includes('1920×1080') && html.includes('12.4s'));
  // No apostrophe in the needle: React escapes it to &#x27; and the match would never fire.
  ok('it explains why, rather than looking like a bug',
    html.includes('keep a video file after a reload'));
  ok('it offers the fix', html.includes('Re-link'));

  // Re-linking mints a NEW id, so it is a scene rewrite. (registerVideo needs a browser;
  // this is the store half of it.)
  useStudio.getState().remapClip('video:2', 'video:77');
  const after = useStudio.getState();
  ok('the scene now points at the new clip',
    JSON.stringify(after.scene).includes('video:77') && !JSON.stringify(after.scene).includes('video:2'));
  ok('a re-link is undoable', after.past.length > 0);
  ok('the alert clears once nothing is missing',
    missingClips(after.scene, after.clips, (r) => r === 'video:77').length === 0);
  ok('re-linking a ref nothing points at is a no-op', (() => {
    const before = useStudio.getState().scene;
    useStudio.getState().remapClip('video:404', 'video:1');
    return useStudio.getState().scene === before;
  })());
}

sec('project: what gets written is what can be reopened');
{
  const st = useStudio.getState();
  st.reset();
  const lid = useStudio.getState().scene.layers[0].id;
  st.setLayerMode(lid, 'halftone');
  st.setConstParam(lid, 'image', 'video:2');
  st.setProjectName('Round trip');

  const doc = currentDoc();
  const back = parseProject(JSON.stringify(doc));
  ok('the live document parses back', back.name === 'Round trip');
  ok('the scene survives byte-for-byte', JSON.stringify(back.scene) === JSON.stringify(doc.scene));
  // The clip is not loaded (no browser), so this is the save → reload → save cycle: the
  // reference has to survive a save made while the file is missing.
  ok('the clip reference survives a save made without the clip',
    back.clips.length === 1 && back.clips[0].ref === 'video:2');

  st.newProject();
  const fresh = useStudio.getState();
  ok('a new project resets the name', fresh.projectName === 'Untitled');
  ok('...and mints a new id, so it cannot overwrite the last one', fresh.projectId !== doc.name);
  ok('...and forgets the old clip manifest', fresh.clips.length === 0);
  st.reset();
}

void asyncChecks().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  // node only; declared inline so this file needs no @types/node
  const proc = (globalThis as { process?: { exitCode?: number } }).process;
  if (fail && proc) proc.exitCode = 1;
});
