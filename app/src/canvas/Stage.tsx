import { useEffect, useRef } from 'react';
import { paintScene } from '../engine/paint';
import { resolveParam, type Param } from '../domain/params';
import { useStudio } from '../state/store';

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

  const layer = scene.layers[0];
  const spawn = layer.spawn;
  const brushActive = spawn.kind === 'brush';
  const brushMask = spawn.kind === 'brush' ? spawn.mask : null;
  const spawnInvert = spawn.kind === 'brush' ? spawn.invert : false;

  // paint artwork + optional grid guide (guide is live-only; exports use paintScene alone)
  useEffect(() => {
    const c = mainRef.current;
    if (!c) return;
    if (c.width !== scene.width) c.width = scene.width;
    if (c.height !== scene.height) c.height = scene.height;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    paintScene(ctx, scene, playhead);
    if (showGrid) {
      const cols = Number(resolveParam(layer.params.cols as Param<number>, playhead));
      const rows = Number(resolveParam(layer.params.rows as Param<number>, playhead));
      if (cols > 0 && rows > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(120,120,120,.28)';
        ctx.lineWidth = 1;
        const cw = scene.width / cols;
        const ch = scene.height / rows;
        for (let i = 1; i < cols; i++) {
          ctx.beginPath();
          ctx.moveTo(i * cw, 0);
          ctx.lineTo(i * cw, scene.height);
          ctx.stroke();
        }
        for (let j = 1; j < rows; j++) {
          ctx.beginPath();
          ctx.moveTo(0, j * ch);
          ctx.lineTo(scene.width, j * ch);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }, [scene, playhead, imageVersion, showGrid, layer]);

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
