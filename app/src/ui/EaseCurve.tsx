import { sampleCurve, segmentProgress, type EaseHalf } from '../domain/easing';

/**
 * The composed curve of one segment, drawn. Time runs left→right, value bottom→top,
 * so a slow start reads as a flat left edge — the shape you feel in the preview.
 * Overshoot (back/elastic) is drawn outside the box on purpose.
 */
export function EaseCurve({
  fromOut,
  toIn,
  width = 100,
  height = 100,
  progress,
  faint = false,
}: {
  fromOut: EaseHalf;
  toIn: EaseHalf;
  width?: number;
  height?: number;
  /** 0..1 position within the segment — draws the playhead dot on the curve. */
  progress?: number;
  faint?: boolean;
}) {
  const pts = sampleCurve(fromOut, toIn, 56);
  // padding leaves room for overshoot above/below the 0..1 band
  const pad = 0.28;
  const span = 1 + pad * 2;
  const toY = (v: number) => ((1 + pad - v) / span) * height;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(p.x * width).toFixed(2)} ${toY(p.y).toFixed(2)}`).join(' ');
  const stroke = faint ? 'var(--muted)' : 'var(--accent)';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'visible' }}>
      <line x1={0} y1={toY(0)} x2={width} y2={toY(0)} stroke="var(--line)" strokeWidth={1} />
      <line x1={0} y1={toY(1)} x2={width} y2={toY(1)} stroke="var(--line)" strokeWidth={1} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" />
      {progress != null && progress >= 0 && progress <= 1 && (
        <circle
          cx={progress * width}
          cy={toY(segmentProgress(fromOut, toIn, progress))}
          r={2.6}
          fill="var(--text)"
        />
      )}
    </svg>
  );
}
