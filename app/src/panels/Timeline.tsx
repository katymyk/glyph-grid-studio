import { useEffect, useRef } from 'react';
import { keyIndexAt, resolveParam, type Keyframe, type Param } from '../domain/params';
import { sampleCurve } from '../domain/easing';
import { frameAt, frameAtWall, frameCount, timeOfFrame, type PlayAnchor } from '../domain/timeline';
import type { Layer, LayerMorph } from '../domain/scene';
import { getMode } from '../engine/modes';
import { readParam, useStudio, type Slot, type TimelineSel } from '../state/store';
import { paramLabel } from './paramLabels';
import { EasingInspector } from './EasingInspector';
import styles from '../ui/timeline.module.css';

/** One editable track: a param in some slot of some layer. */
interface TrackRow {
  layerId: string;
  slot: Slot;
  param: string;
  label: string;
  keys: Keyframe<unknown>[];
}

/** Every animated track of a layer, in the order a person reads them. */
function rowsForLayer(layer: Layer): TrackRow[] {
  const rows: TrackRow[] = [];
  const push = (slot: Slot, param: string, p: Param<unknown> | undefined, label: string) => {
    if (p && p.kind === 'keys') rows.push({ layerId: layer.id, slot, param, label, keys: p.keys });
  };
  push('layer', 'opacity', layer.opacity as Param<unknown>, 'Layer opacity');
  for (const [k, p] of Object.entries(layer.params)) push('base', k, p, paramLabel(layer.mode, k));
  if (layer.morph) {
    const to = getMode(layer.morph.mode).label;
    for (const [k, p] of Object.entries(layer.morph.params)) {
      push('morph', k, p, `→ ${to} · ${paramLabel(layer.morph.mode, k)}`);
    }
  }
  return rows;
}

const NICE_STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
function tickStepFrames(total: number): number {
  const want = total / 10;
  return NICE_STEPS.find((s) => s >= want) ?? 1000;
}

/**
 * The timeline dock: transport, a frame ruler, one row per animated param with
 * draggable keyframes and the real easing curve drawn between them, the mode-morph
 * bar, and an inspector for the selected keyframe's easing.
 */
export function Timeline() {
  const scene = useStudio((s) => s.scene);
  const playhead = useStudio((s) => s.playhead);
  const playing = useStudio((s) => s.playing);
  const activeLayerId = useStudio((s) => s.activeLayerId);
  const selection = useStudio((s) => s.selection);
  const height = useStudio((s) => s.timelineHeight);
  const setTimelineHeight = useStudio((s) => s.setTimelineHeight);
  const setPlayhead = useStudio((s) => s.setPlayhead);
  const stepFrame = useStudio((s) => s.stepFrame);
  const play = useStudio((s) => s.play);
  const pause = useStudio((s) => s.pause);
  const setDuration = useStudio((s) => s.setDuration);
  const setFps = useStudio((s) => s.setFps);
  const selectLayer = useStudio((s) => s.selectLayer);
  const deleteKeyframe = useStudio((s) => s.deleteKeyframe);

  const { duration, fps } = scene;
  const totalFrames = frameCount(scene);
  const frame = frameAt(scene, playhead);
  const snap = (t: number) => timeOfFrame(scene, frameAt(scene, t));

  /**
   * Advance the playhead while playing — on the scene's frame grid, not on the display's.
   *
   * The early return when the frame hasn't changed is the load-bearing line, and it is what
   * makes `fps` a real setting: at 12fps on a 120Hz panel nine ticks in ten do nothing, so
   * the preview visibly steps AND the store is notified twelve times a second instead of a
   * hundred and twenty. Everything subscribed to the playhead — the canvas repaint, every
   * sidebar control, this dock — was previously paying display rate for a 12fps comp.
   *
   * Wall-clock anchored rather than accumulated, so a long frame costs one skipped frame
   * instead of permanent drift (see `frameAtWall`).
   */
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const st = useStudio.getState();
    let anchor: PlayAnchor = {
      frame: frameAt(st.scene, st.playhead),
      wallMs: performance.now(),
      fps: st.scene.fps,
    };
    let shown = -1;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const grid = useStudio.getState().scene;
      if (grid.fps !== anchor.fps) {
        // fps is an ordinary control and gets dragged mid-playback. Re-anchor on the
        // SECOND we are at, not the frame index: the same index means a different time
        // under a new grid, so reusing it would jump the playhead.
        const at = shown < 0 ? anchor.frame / Math.max(1, anchor.fps) : shown / Math.max(1, anchor.fps);
        anchor = { frame: frameAt(grid, at), wallMs: now, fps: grid.fps };
        shown = -1;
      }
      const f = frameAtWall(anchor, now, frameCount(grid));
      if (f === shown) return;
      shown = f;
      setPlayhead(timeOfFrame(grid, f));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, setPlayhead]);

  // Delete removes the selected keyframe (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const sel = useStudio.getState().selection;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel?.kind === 'key') {
        e.preventDefault();
        deleteKeyframe(sel.layerId, sel.slot, sel.param, sel.index);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteKeyframe]);

  // dock resize
  const resizing = useRef<{ y: number; h: number } | null>(null);

  // ruler scrub
  const scrubbing = useRef<DOMRect | null>(null);
  const scrubTo = (clientX: number, rect: DOMRect) =>
    setPlayhead(snap(((clientX - rect.left) / Math.max(1, rect.width)) * duration));

  const layers = [...scene.layers].reverse(); // top layer first, like the Layers panel
  const anyRows = scene.layers.some((l) => rowsForLayer(l).length > 0 || l.morph);

  return (
    <div className={styles.dock} style={{ height }}>
      <div
        className={styles.grab}
        title="Drag to resize the timeline"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          resizing.current = { y: e.clientY, h: height };
        }}
        onPointerMove={(e) => {
          const r = resizing.current;
          if (r) setTimelineHeight(r.h - (e.clientY - r.y));
        }}
        onPointerUp={() => {
          resizing.current = null;
        }}
      />

      <div className={styles.body}>
        <div className={styles.main}>
          {/* transport */}
          <div className={styles.bar}>
            <button className={styles.tBtn} title="Go to start" onClick={() => setPlayhead(0)}>
              ⏮
            </button>
            <button className={styles.tBtn} title="Previous frame" onClick={() => stepFrame(-1)}>
              ◀
            </button>
            <button
              className={`${styles.tBtn} ${playing ? styles.tBtnOn : ''}`}
              title="Play / pause (space)"
              onClick={() => (playing ? pause() : play())}
            >
              {playing ? '⏸' : '▶'}
            </button>
            <button className={styles.tBtn} title="Next frame" onClick={() => stepFrame(1)}>
              ▶
            </button>
            <span className={styles.readout}>
              f{String(frame).padStart(3, '0')}
              <span className={styles.readoutMuted}>
                {' / '}
                {totalFrames} · {playhead.toFixed(2)}s
              </span>
            </span>
            <span className={styles.spacer} />
            <span className={styles.barLabel}>fps</span>
            <input
              className={styles.numTiny}
              type="number"
              min={1}
              max={60}
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
            />
            <span className={styles.barLabel}>secs</span>
            <input
              className={styles.numTiny}
              type="number"
              min={0.1}
              step={0.5}
              value={duration}
              title="Loop length (seconds)"
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </div>

          {/* ruler */}
          <div className={styles.rulerRow}>
            <div className={styles.rulerGutter}>frames</div>
            <div
              className={styles.ruler}
              onPointerDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                scrubbing.current = rect;
                e.currentTarget.setPointerCapture(e.pointerId);
                pause();
                scrubTo(e.clientX, rect);
              }}
              onPointerMove={(e) => {
                if (scrubbing.current) scrubTo(e.clientX, scrubbing.current);
              }}
              onPointerUp={() => {
                scrubbing.current = null;
              }}
            >
              {(() => {
                const step = tickStepFrames(totalFrames);
                const minor = totalFrames <= 140;
                const out = [];
                for (let f = 0; f <= totalFrames; f++) {
                  const major = f % step === 0;
                  if (!major && !minor) continue;
                  const left = `${(f / totalFrames) * 100}%`;
                  out.push(
                    <span key={f} className={major ? `${styles.tick} ${styles.tickMajor}` : styles.tick} style={{ left }} />,
                  );
                  if (major && f < totalFrames) {
                    out.push(
                      <span key={`l${f}`} className={styles.tickLabel} style={{ left }}>
                        {f}
                      </span>,
                    );
                  }
                }
                return out;
              })()}
              <span className={styles.phHandle} style={{ left: `${(playhead / duration) * 100}%` }} />
            </div>
          </div>

          {/* tracks */}
          <div className={styles.scroll}>
            <div className={styles.rows}>
              {layers.map((layer) => {
                const rows = rowsForLayer(layer);
                const isActive = layer.id === activeLayerId;
                return (
                  <div key={layer.id}>
                    <div className={styles.layerHead}>
                      <span
                        className={`${styles.layerName} ${isActive ? styles.layerNameOn : ''}`}
                        onClick={() => selectLayer(layer.id)}
                        title="Select this layer"
                      >
                        {isActive ? '▸' : '·'} {layer.name}
                      </span>
                      <span className={styles.layerName} style={{ paddingLeft: 8, cursor: 'default' }}>
                        {getMode(layer.mode).label}
                        {layer.morph ? ` → ${getMode(layer.morph.mode).label}` : ''}
                      </span>
                    </div>

                    {layer.morph && (
                      <MorphRow layer={layer} morph={layer.morph} duration={duration} snap={snap} fps={fps} />
                    )}

                    {rows.map((row) => (
                      <ParamRow
                        key={`${row.slot}:${row.param}`}
                        row={row}
                        duration={duration}
                        playhead={playhead}
                        snap={snap}
                        selection={selection}
                      />
                    ))}

                    {!rows.length && !layer.morph && (
                      <div className={styles.row}>
                        <span className={styles.rowGutter} style={{ opacity: 0.6 }}>
                          no keyframes
                        </span>
                        <span className={styles.rowGutter} style={{ border: 0, fontSize: 10.5, opacity: 0.6 }}>
                          click ◆ beside any slider in the sidebar to animate it
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

              {!anyRows && (
                <div className={styles.empty}>
                  Nothing animated yet. Click the ◆ beside a slider to key it, or set a
                  <strong> mode morph</strong> in the Mode panel to hand over from one mode to another.
                </div>
              )}

              {/* playhead line, aligned to the same grid as every row */}
              <div className={styles.overlay}>
                <span />
                <div className={styles.overlayTrack}>
                  <span className={styles.playhead} style={{ left: `${(playhead / duration) * 100}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.side}>
          <EasingInspector />
        </div>
      </div>
    </div>
  );
}

/** One param track: keyframe diamonds + a curve-drawn segment between each pair. */
function ParamRow({
  row,
  duration,
  playhead,
  snap,
  selection,
}: {
  row: TrackRow;
  duration: number;
  playhead: number;
  snap: (t: number) => number;
  selection: TimelineSel;
}) {
  const selectTimeline = useStudio((s) => s.selectTimeline);
  const dragKeyframe = useStudio((s) => s.dragKeyframe);
  const addKeyframeAt = useStudio((s) => s.addKeyframeAt);
  const deleteKeyframe = useStudio((s) => s.deleteKeyframe);
  const toggleParamAnimated = useStudio((s) => s.toggleParamAnimated);
  const setPlayhead = useStudio((s) => s.setPlayhead);
  const selectLayer = useStudio((s) => s.selectLayer);

  const drag = useRef<DOMRect | null>(null);
  const { keys } = row;
  const selHere =
    selection?.kind === 'key' &&
    selection.layerId === row.layerId &&
    selection.slot === row.slot &&
    selection.param === row.param;
  const atPlayhead = keyIndexAt({ kind: 'keys', keys }, playhead, 1e-3);
  const pct = (t: number) => `${(t / duration) * 100}%`;

  /** Live index of the dragged key — reorders when it crosses a neighbour. */
  const liveIndex = (fallback: number) => {
    const sel = useStudio.getState().selection;
    return sel?.kind === 'key' && sel.layerId === row.layerId && sel.slot === row.slot && sel.param === row.param
      ? sel.index
      : fallback;
  };

  return (
    <div className={`${styles.row} ${selHere ? styles.rowSel : ''}`}>
      <span className={styles.rowGutter}>
        <button
          className={`${styles.iconBtn} ${atPlayhead >= 0 ? styles.iconBtnOn : ''}`}
          title={atPlayhead >= 0 ? 'Remove the keyframe at the playhead' : 'Add a keyframe at the playhead'}
          onClick={() =>
            atPlayhead >= 0
              ? deleteKeyframe(row.layerId, row.slot, row.param, atPlayhead)
              : addKeyframeAt(row.layerId, row.slot, row.param, playhead)
          }
        >
          ◆
        </button>
        <span
          className={`${styles.rowLabel} ${selHere ? styles.rowLabelOn : ''}`}
          title={row.label}
          onClick={() => selectLayer(row.layerId)}
        >
          {row.label}
        </span>
        <button
          className={styles.iconBtn}
          title="Stop animating — freeze at the playhead value"
          onClick={() => toggleParamAnimated(row.layerId, row.param, playhead, row.slot)}
        >
          ×
        </button>
      </span>

      <div
        className={styles.track}
        onDoubleClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const t = snap(((e.clientX - rect.left) / rect.width) * duration);
          addKeyframeAt(row.layerId, row.slot, row.param, t);
        }}
        title="Double-click to add a keyframe"
      >
        {keys.slice(0, -1).map((a, i) => {
          const b = keys[i + 1];
          const left = (a.t / duration) * 100;
          const width = Math.max(0, ((b.t - a.t) / duration) * 100);
          const selSeg = selHere && selection.index === i;
          return (
            <div
              key={`s${i}`}
              className={`${styles.seg} ${selSeg ? styles.segSel : ''}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={a.hold ? 'Held (step) — no interpolation' : 'Segment easing — click to edit'}
              onClick={() =>
                selectTimeline({ kind: 'key', layerId: row.layerId, slot: row.slot, param: row.param, index: i })
              }
            >
              <SegmentCurve a={a} b={b} />
            </div>
          );
        })}

        {keys.map((k, i) => (
          <button
            key={`k${i}`}
            className={`${styles.key} ${selHere && selection.index === i ? styles.keyOn : ''} ${
              k.hold ? styles.keyHold : ''
            }`}
            style={{ left: pct(k.t) }}
            title={`Keyframe · drag to move${k.hold ? ' · held' : ''}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              const track = e.currentTarget.parentElement;
              if (!track) return;
              drag.current = track.getBoundingClientRect();
              e.currentTarget.setPointerCapture(e.pointerId);
              selectTimeline({ kind: 'key', layerId: row.layerId, slot: row.slot, param: row.param, index: i });
              setPlayhead(k.t); // land on the key so sidebar edits target it
            }}
            onPointerMove={(e) => {
              const rect = drag.current;
              if (!rect) return;
              const t = snap(((e.clientX - rect.left) / rect.width) * duration);
              dragKeyframe(row.layerId, row.slot, row.param, liveIndex(i), t);
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              deleteKeyframe(row.layerId, row.slot, row.param, liveIndex(i));
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** The segment's actual easing curve, stretched to the segment's width. */
function SegmentCurve({ a, b }: { a: Keyframe<unknown>; b: Keyframe<unknown> }) {
  if (a.hold) {
    // a held key is a step: flat, then a jump at the far end
    return (
      <svg className={styles.segSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points="0,90 100,90 100,10" fill="none" stroke="var(--muted)" strokeWidth="6" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  const pts = sampleCurve(a.easeOut, b.easeIn, 28)
    .map((p) => `${(p.x * 100).toFixed(1)},${(90 - p.y * 80).toFixed(1)}`)
    .join(' ');
  return (
    <svg className={styles.segSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The mode-morph bar: drag the body to slide the handover, the edges to retime it. */
function MorphRow({
  layer,
  morph,
  duration,
  snap,
  fps,
}: {
  layer: Layer;
  morph: LayerMorph;
  duration: number;
  snap: (t: number) => number;
  fps: number;
}) {
  const setMorphRange = useStudio((s) => s.setMorphRange);
  const setMorphMode = useStudio((s) => s.setMorphMode);
  const selectTimeline = useStudio((s) => s.selectTimeline);
  const selection = useStudio((s) => s.selection);
  const drag = useRef<{ rect: DOMRect; kind: 'start' | 'end' | 'body'; t0: number; start: number; end: number } | null>(
    null,
  );

  const selHere = selection?.kind === 'morph' && selection.layerId === layer.id;
  const left = (morph.start / duration) * 100;
  const width = Math.max(0.4, ((morph.end - morph.start) / duration) * 100);
  const from = getMode(layer.mode).label;
  const to = getMode(morph.mode).label;

  const begin = (e: React.PointerEvent, kind: 'start' | 'end' | 'body') => {
    e.stopPropagation();
    const track = e.currentTarget.closest(`.${styles.track}`) as HTMLElement | null;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const t0 = ((e.clientX - rect.left) / rect.width) * duration;
    drag.current = { rect, kind, t0, start: morph.start, end: morph.end };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    selectTimeline({ kind: 'morph', layerId: layer.id });
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const t = ((e.clientX - d.rect.left) / d.rect.width) * duration;
    if (d.kind === 'start') setMorphRange(layer.id, Math.min(snap(t), d.end), d.end);
    else if (d.kind === 'end') setMorphRange(layer.id, d.start, Math.max(snap(t), d.start));
    else {
      const span = d.end - d.start;
      const shift = Math.max(-d.start, Math.min(duration - d.end, t - d.t0));
      setMorphRange(layer.id, snap(d.start + shift), snap(d.start + shift) + span);
    }
  };
  const end = () => {
    drag.current = null;
  };

  return (
    <div className={`${styles.row} ${selHere ? styles.rowSel : ''}`}>
      <span className={styles.rowGutter}>
        <button
          className={`${styles.iconBtn} ${styles.iconBtnOn}`}
          title="Mode morph — click to inspect"
          onClick={() => selectTimeline({ kind: 'morph', layerId: layer.id })}
        >
          ⇥
        </button>
        <span className={`${styles.rowLabel} ${styles.rowLabelOn}`} title={`${from} → ${to}`}>
          Mode morph
        </span>
        <button
          className={styles.iconBtn}
          title="Remove the morph — the layer stays one mode"
          onClick={() => setMorphMode(layer.id, null)}
        >
          ×
        </button>
      </span>

      <div className={styles.track}>
        {morph.start > duration * 0.06 && (
          <span className={styles.morphSide} style={{ left: 4 }}>
            {from}
          </span>
        )}
        {morph.end < duration * 0.94 && (
          <span className={styles.morphSide} style={{ right: 4 }}>
            {to}
          </span>
        )}
        <div
          className={`${styles.morphBar} ${selHere ? styles.morphBarSel : ''}`}
          style={{ left: `${left}%`, width: `${width}%` }}
          title={`${from} → ${to} · frames ${frameAt({ fps }, morph.start)}–${frameAt({ fps }, morph.end)} · drag to move`}
          onPointerDown={(e) => begin(e, 'body')}
          onPointerMove={move}
          onPointerUp={end}
        >
          <span className={styles.morphBarText}>{width > 14 ? `${from} → ${to}` : '→'}</span>
          <span
            className={styles.morphEdge}
            style={{ left: 0 }}
            onPointerDown={(e) => begin(e, 'start')}
            onPointerMove={move}
            onPointerUp={end}
          />
          <span
            className={styles.morphEdge}
            style={{ right: 0 }}
            onPointerDown={(e) => begin(e, 'end')}
            onPointerMove={move}
            onPointerUp={end}
          />
        </div>
      </div>
    </div>
  );
}

/** Value of a selected track at time t, formatted for the inspector. */
export function trackValueAt(layer: Layer, slot: Slot, param: string, t: number): string {
  const p = readParam(layer, slot, param);
  if (!p) return '—';
  const v = resolveParam(p, t);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (Array.isArray(v)) return v.slice(0, 6).join(' ');
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') return v.length > 18 ? `${v.slice(0, 18)}…` : v;
  return String(v);
}

export { rowsForLayer };
