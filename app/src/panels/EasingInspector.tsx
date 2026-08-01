import { keysOf, type Keyframe, type Param } from '../domain/params';
import { SEGMENT_PRESETS, type EaseHalf } from '../domain/easing';
import { frameAt, frameCount, timeOfFrame } from '../domain/timeline';
import type { Layer, MorphStyle } from '../domain/scene';
import { getMode } from '../engine/modes';
import { readParam, useStudio, type Slot } from '../state/store';
import { paramLabel } from './paramLabels';
import { trackValueAt } from './Timeline';
import { EaseCurve } from '../ui/EaseCurve';
import { EaseSelect } from '../ui/EaseSelect';
import styles from '../ui/timeline.module.css';

/**
 * Easing editor for whatever the timeline has selected.
 *
 * A keyframe shows both of its segments — the one arriving from the previous key and
 * the one leaving toward the next — because "ease in / ease out" only means something
 * relative to a neighbour. Each segment exposes both of its ends plus named presets.
 */
export function EasingInspector() {
  const selection = useStudio((s) => s.selection);
  const scene = useStudio((s) => s.scene);
  const playhead = useStudio((s) => s.playhead);

  if (!selection) {
    return (
      <>
        <p className={styles.sideTitle}>easing</p>
        <p className={styles.sideSub} style={{ lineHeight: 1.6 }}>
          Select a keyframe ◆ or a segment on the timeline to set how it eases in and out.
        </p>
        <p className={styles.sideSub} style={{ lineHeight: 1.6 }}>
          Drag keyframes to retime · double-click a track to add one · double-click a keyframe (or
          press Delete) to remove it.
        </p>
      </>
    );
  }

  const layer = scene.layers.find((l) => l.id === selection.layerId);
  if (!layer) return null;

  return selection.kind === 'morph' ? (
    <MorphInspector layer={layer} fps={scene.fps} duration={scene.duration} playhead={playhead} />
  ) : (
    <KeyInspector
      layer={layer}
      slot={selection.slot}
      param={selection.param}
      index={selection.index}
      fps={scene.fps}
      playhead={playhead}
    />
  );
}

function KeyInspector({
  layer,
  slot,
  param,
  index,
  fps,
  playhead,
}: {
  layer: Layer;
  slot: Slot;
  param: string;
  index: number;
  fps: number;
  playhead: number;
}) {
  const setKeyframeEase = useStudio((s) => s.setKeyframeEase);
  const setKeyframeHold = useStudio((s) => s.setKeyframeHold);
  const setTrackEasing = useStudio((s) => s.setTrackEasing);
  const deleteKeyframe = useStudio((s) => s.deleteKeyframe);
  const selectTimeline = useStudio((s) => s.selectTimeline);
  const setPlayhead = useStudio((s) => s.setPlayhead);

  const p = readParam(layer, slot, param) as Param<unknown> | undefined;
  const keys = keysOf(p);
  const key = keys[index];
  if (!key) return null;
  const prev = keys[index - 1];
  const next = keys[index + 1];

  const mode = slot === 'morph' ? layer.morph?.mode ?? layer.mode : layer.mode;
  const label = slot === 'layer' ? 'Layer opacity' : paramLabel(mode, param);
  const goto = (i: number) => {
    const k = keys[i];
    if (!k) return;
    selectTimeline({ kind: 'key', layerId: layer.id, slot, param, index: i });
    setPlayhead(k.t);
  };
  const localProgress = (a: Keyframe<unknown>, b: Keyframe<unknown>) => {
    const span = b.t - a.t;
    if (span <= 0) return undefined;
    const u = (playhead - a.t) / span;
    return u >= 0 && u <= 1 ? u : undefined;
  };

  return (
    <>
      <p className={styles.sideTitle}>keyframe {index + 1} of {keys.length}</p>
      <p className={styles.sideHead}>
        {slot === 'morph' ? '→ ' : ''}
        {label}
      </p>
      <p className={styles.sideSub}>
        frame {frameAt({ fps }, key.t)} · {key.t.toFixed(2)}s · value{' '}
        {trackValueAt(layer, slot, param, key.t)}
      </p>

      {prev ? (
        <SegmentEditor
          title="arrives from previous ◆"
          out={prev.easeOut}
          easeIn={key.easeIn}
          held={prev.hold === true}
          progress={localProgress(prev, key)}
          onOut={(c) => setKeyframeEase(layer.id, slot, param, index - 1, 'out', c)}
          onIn={(c) => setKeyframeEase(layer.id, slot, param, index, 'in', c)}
        />
      ) : (
        <div className={styles.block}>
          <p className={styles.blockTitle}>arrives from previous ◆</p>
          <p className={styles.sideSub} style={{ margin: 0 }}>
            first keyframe — nothing before it
          </p>
        </div>
      )}

      {next ? (
        <SegmentEditor
          title="leaves toward next ◆"
          out={key.easeOut}
          easeIn={next.easeIn}
          held={key.hold === true}
          progress={localProgress(key, next)}
          onOut={(c) => setKeyframeEase(layer.id, slot, param, index, 'out', c)}
          onIn={(c) => setKeyframeEase(layer.id, slot, param, index + 1, 'in', c)}
        />
      ) : (
        <div className={styles.block}>
          <p className={styles.blockTitle}>leaves toward next ◆</p>
          <p className={styles.sideSub} style={{ margin: 0 }}>
            last keyframe — nothing after it
          </p>
        </div>
      )}

      <div className={styles.holdRow}>
        <span title="Freeze this value until the next keyframe (step, no interpolation)">
          Hold until next ◆
        </span>
        <input
          type="checkbox"
          checked={key.hold === true}
          onChange={(e) => setKeyframeHold(layer.id, slot, param, index, e.target.checked)}
        />
      </div>

      <div className={styles.sideBtnRow}>
        <button className={styles.sideBtn} disabled={!prev} onClick={() => goto(index - 1)} title="Previous keyframe">
          ◀ ◆
        </button>
        <button className={styles.sideBtn} disabled={!next} onClick={() => goto(index + 1)} title="Next keyframe">
          ◆ ▶
        </button>
      </div>
      <div className={styles.sideBtnRow}>
        <button
          className={styles.sideBtn}
          title="Give every keyframe in this track the easing of this one"
          onClick={() => setTrackEasing(layer.id, slot, param, key.easeOut, key.easeIn)}
        >
          Apply to track
        </button>
        <button
          className={`${styles.sideBtn} ${styles.sideBtnDanger}`}
          onClick={() => deleteKeyframe(layer.id, slot, param, index)}
          title="Delete this keyframe"
        >
          Delete ◆
        </button>
      </div>
    </>
  );
}

function MorphInspector({
  layer,
  fps,
  duration,
  playhead,
}: {
  layer: Layer;
  fps: number;
  duration: number;
  playhead: number;
}) {
  const setMorphRange = useStudio((s) => s.setMorphRange);
  const setMorphStyle = useStudio((s) => s.setMorphStyle);
  const setMorphEase = useStudio((s) => s.setMorphEase);
  const setMorphMode = useStudio((s) => s.setMorphMode);
  const m = layer.morph;
  if (!m) return null;

  const span = m.end - m.start;
  const progress = span > 0 ? (playhead - m.start) / span : undefined;
  const styleBtn = (s: MorphStyle, label: string, hint: string) => (
    <button
      key={s}
      className={`${styles.preset} ${m.style === s ? styles.presetOn : ''}`}
      onClick={() => setMorphStyle(layer.id, s)}
      title={hint}
    >
      {label}
    </button>
  );

  return (
    <>
      <p className={styles.sideTitle}>mode morph</p>
      <p className={styles.sideHead}>
        {getMode(layer.mode).label} → {getMode(m.mode).label}
      </p>
      <p className={styles.sideSub}>
        frames {frameAt({ fps }, m.start)}–{frameAt({ fps }, m.end)} · {span.toFixed(2)}s
      </p>

      <div className={styles.block}>
        <p className={styles.blockTitle}>handover range</p>
        <div style={{ display: 'flex', gap: 6 }}>
          <label className={styles.easeField}>
            <span className={styles.easeLabel}>start</span>
            <input
              className={styles.numTiny}
              type="number"
              min={0}
              max={frameCount({ fps, duration }) - 1}
              value={frameAt({ fps }, m.start)}
              onChange={(e) =>
                setMorphRange(layer.id, timeOfFrame({ fps, duration }, Number(e.target.value)), m.end)
              }
            />
          </label>
          <label className={styles.easeField}>
            <span className={styles.easeLabel}>end</span>
            <input
              className={styles.numTiny}
              type="number"
              min={0}
              max={frameCount({ fps, duration }) - 1}
              value={frameAt({ fps }, m.end)}
              onChange={(e) =>
                setMorphRange(layer.id, m.start, timeOfFrame({ fps, duration }, Number(e.target.value)))
              }
            />
          </label>
        </div>
        <div className={styles.presets}>
          {styleBtn('dissolve', 'Dissolve', 'Elements swap one at a time — one mode pops out as the other pops in')}
          {styleBtn('fade', 'Fade', 'Both modes overlap and cross-fade')}
        </div>
      </div>

      <SegmentEditor
        title="handover curve"
        out={m.easeOut}
        easeIn={m.easeIn}
        progress={progress != null && progress >= 0 && progress <= 1 ? progress : undefined}
        onOut={(c) => setMorphEase(layer.id, 'out', c)}
        onIn={(c) => setMorphEase(layer.id, 'in', c)}
      />

      <div className={styles.sideBtnRow}>
        <button
          className={`${styles.sideBtn} ${styles.sideBtnDanger}`}
          onClick={() => setMorphMode(layer.id, null)}
          title="Remove the morph"
        >
          Remove morph
        </button>
      </div>
    </>
  );
}

/** Both ends of one segment + its live curve + named presets. */
function SegmentEditor({
  title,
  out,
  easeIn,
  held = false,
  progress,
  onOut,
  onIn,
}: {
  title: string;
  out: EaseHalf;
  easeIn: EaseHalf;
  held?: boolean;
  progress?: number;
  onOut: (c: EaseHalf) => void;
  onIn: (c: EaseHalf) => void;
}) {
  const applyPreset = (o: EaseHalf, i: EaseHalf) => {
    onOut(o);
    onIn(i);
  };
  return (
    <div className={styles.block}>
      <p className={styles.blockTitle}>
        <span>{title}</span>
        {held && <span style={{ color: 'var(--accent-fg)' }}>held</span>}
      </p>
      <div className={styles.curveWrap}>
        <div className={styles.curveBox}>
          <EaseCurve fromOut={out} toIn={easeIn} width={44} height={44} progress={progress} faint={held} />
        </div>
        <div className={styles.curveMeta}>
          <EaseSelect
            label="out"
            hint="How the value LEAVES the keyframe on the left of this segment"
            value={out}
            onChange={onOut}
            disabled={held}
          />
          <EaseSelect
            label="in"
            hint="How the value ARRIVES at the keyframe on the right of this segment"
            value={easeIn}
            onChange={onIn}
            disabled={held}
          />
        </div>
      </div>
      <div className={styles.presets}>
        {SEGMENT_PRESETS.map((p) => (
          <button
            key={p.key}
            className={`${styles.preset} ${out === p.out && easeIn === p.in ? styles.presetOn : ''}`}
            onClick={() => applyPreset(p.out, p.in)}
            disabled={held}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
