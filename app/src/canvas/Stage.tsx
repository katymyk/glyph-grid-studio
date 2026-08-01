import { useEffect, useRef } from 'react';
import { paintScene } from '../engine/paint';
import { resolveParam, type Param } from '../domain/params';
import { ROW_PITCH, effectiveCell, type Lattice } from '../engine/halftone/screen';
import { useStudio, useActiveLayer } from '../state/store';

/** Resolve an optional param at time t, falling back when the mode doesn't declare it. */
function read<T>(p: Param<unknown> | undefined, t: number, fallback: T): T {
  return p ? (resolveParam(p, t) as T) : fallback;
}

/** Canvas surface: main artwork canvas + a brush-mask overlay, both scaled to fit. */
export function Stage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);

  const scene = useStudio((s) => s.scene);
  const playhead = useStudio((s) => s.playhead);
  const imageVersion = useStudio((s) => s.imageVersion);
  const showGrid = useStudio((s) => s.showGrid);
  const brushSize = useStudio((s) => s.brushSize);
  const brushErase = useStudio((s) => s.brushErase);
  const maskVisible = useStudio((s) => s.maskVisible);
  const setSpawn = useStudio((s) => s.setSpawn);
  const setElementCount = useStudio((s) => s.setElementCount);

  const layer = useActiveLayer();
  const spawn = layer.spawn;
  const brushActive = spawn.kind === 'brush';
  const brushMask = spawn.kind === 'brush' ? spawn.mask : null;
  const spawnInvert = spawn.kind === 'brush' ? spawn.invert : false;

  const lastCountRef = useRef(-1);

  // paint artwork + optional grid guide (guide is live-only; exports use paintScene alone)
  useEffect(() => {
    const c = mainRef.current;
    if (!c) return;
    if (c.width !== scene.width) c.width = scene.width;
    if (c.height !== scene.height) c.height = scene.height;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const drawn = paintScene(ctx, scene, playhead);
    // Only touch the store when the number actually moved: every repaint would
    // otherwise sweep all subscribers just to hand them the value they already had.
    if (drawn !== lastCountRef.current) {
      lastCountRef.current = drawn;
      setElementCount(drawn);
    }
    if (showGrid) {
      // a mode need not have grid params — the guide simply doesn't apply there
      const colsP = layer.params.cols as Param<number> | undefined;
      const rowsP = layer.params.rows as Param<number> | undefined;
      let cols = colsP ? Number(resolveParam(colsP, playhead)) : 0;
      let rows = rowsP ? Number(resolveParam(rowsP, playhead)) : 0;
      // Halftone thinks in a screen pitch rather than cols/rows, so derive the guide
      // from that — through effectiveCell, or the guide would draw the pitch the user
      // asked for rather than the one being rendered. Only for the dot screen, and only
      // when it is axis-aligned: an upright guide over a rotated lattice shows a grid
      // the dots do not sit on.
      const cellP = layer.params.cell as Param<number> | undefined;
      if (!cols && cellP && read(layer.params.algo, playhead, 'halftone') === 'halftone') {
        const angle = Number(read(layer.params.angle, playhead, 0));
        if (Math.abs(angle % 90) < 0.01) {
          const lattice = String(read(layer.params.lattice, playhead, 'square')) as Lattice;
          const cell = effectiveCell(
            scene.width,
            scene.height,
            Math.max(1, Number(resolveParam(cellP, playhead))),
            lattice,
            Number(read(layer.params.maxElements, playhead, 150000)),
          );
          if (cell > 0) {
            cols = Math.round(scene.width / cell);
            rows = Math.round(scene.height / (cell * ROW_PITCH[lattice]));
          }
        }
      }
      // Past a few hundred divisions the guide is a solid wash, not a guide.
      if (cols > 400 || rows > 300) {
        cols = 0;
        rows = 0;
      }
      if (cols > 0 && rows > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(120,120,120,.28)';
        ctx.lineWidth = 1;
        const cw = scene.width / cols;
        const ch = scene.height / rows;
        // One path for the whole grid, not one per line: this can be 700 lines, it runs
        // inside the same effect as the artwork, and it is on screen exactly when someone
        // is dragging `cell` and cares about latency.
        ctx.beginPath();
        for (let i = 1; i < cols; i++) {
          ctx.moveTo(i * cw, 0);
          ctx.lineTo(i * cw, scene.height);
        }
        for (let j = 1; j < rows; j++) {
          ctx.moveTo(0, j * ch);
          ctx.lineTo(scene.width, j * ch);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
  }, [scene, playhead, imageVersion, showGrid, layer, setElementCount]);

  // keep the mask canvas backing sized to the scene
  useEffect(() => {
    const m = maskRef.current;
    if (!m) return;
    if (m.width !== scene.width) m.width = scene.width;
    if (m.height !== scene.height) m.height = scene.height;
  }, [scene.width, scene.height]);

  // (re)load the mask overlay from spawn.mask on external changes (undo/clear/switch)
  const lastMaskRef = useRef<string | null>(null);
  useEffect(() => {
    const m = maskRef.current;
    if (!m) return;
    if (brushMask === lastMaskRef.current) return; // our own commit — skip
    const ctx = m.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, m.width, m.height);
    if (brushMask) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, m.width, m.height);
        ctx.drawImage(img, 0, 0, m.width, m.height);
      };
      img.src = brushMask;
    }
    lastMaskRef.current = brushMask;
  }, [brushMask]);

  // fit the scale box to the viewport, preserving aspect
  useEffect(() => {
    const wrap = wrapRef.current;
    const box = boxRef.current;
    if (!wrap || !box) return;
    const fit = () => {
      const pad = 48;
      const aw = Math.max(1, wrap.clientWidth - pad);
      const ah = Math.max(1, wrap.clientHeight - pad);
      const sc = Math.min(aw / scene.width, ah / scene.height);
      box.style.width = `${Math.round(scene.width * sc)}px`;
      box.style.height = `${Math.round(scene.height * sc)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [scene.width, scene.height]);

  // brush painting
  const painting = useRef(false);
  const paintAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const m = maskRef.current;
    if (!m) return;
    const rect = m.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * scene.width) / rect.width;
    const y = ((e.clientY - rect.top) * scene.height) / rect.height;
    const ctx = m.getContext('2d');
    if (!ctx) return;
    ctx.globalCompositeOperation = brushErase ? 'destination-out' : 'source-over';
    ctx.fillStyle = 'rgba(232,86,46,.95)';
    ctx.beginPath();
    ctx.arc(x, y, brushSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  };
  const commit = () => {
    const m = maskRef.current;
    if (!m) return;
    const url = m.toDataURL();
    lastMaskRef.current = url;
    setSpawn(layer.id, { kind: 'brush', mask: url, invert: spawnInvert });
  };

  return (
    <div
      ref={wrapRef}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: 'repeating-conic-gradient(#191914 0% 25%, #14140f 0% 50%) 50% / 22px 22px',
      }}
    >
      <div ref={boxRef} style={{ position: 'relative', boxShadow: '0 8px 40px rgba(0,0,0,.5)' }}>
        <canvas ref={mainRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        <canvas
          ref={maskRef}
          onPointerDown={(e) => {
            if (!brushActive) return;
            painting.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            paintAt(e);
          }}
          onPointerMove={(e) => {
            if (painting.current) paintAt(e);
          }}
          onPointerUp={() => {
            if (painting.current) {
              painting.current = false;
              commit();
            }
          }}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: brushActive && maskVisible ? 0.5 : 0,
            pointerEvents: brushActive ? 'auto' : 'none',
            cursor: brushActive ? 'crosshair' : 'default',
          }}
        />
      </div>
    </div>
  );
}
