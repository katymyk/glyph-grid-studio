import { useEffect, useRef } from 'react';
import { paintScene } from '../engine/paint';
import { useStudio } from '../state/store';

/** The canvas surface. Backing store is always scene.width × height (full-res);
    it's scaled with CSS to fit the viewport, preserving aspect. */
export function Stage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scene = useStudio((s) => s.scene);
  const playhead = useStudio((s) => s.playhead);
  const imageVersion = useStudio((s) => s.imageVersion);

  // repaint when the scene, playhead, or a decoded image changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== scene.width) canvas.width = scene.width;
    if (canvas.height !== scene.height) canvas.height = scene.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paintScene(ctx, scene, playhead);
  }, [scene, playhead, imageVersion]);

  // fit-to-viewport: scale the canvas (CSS) to fill the stage, preserving aspect
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const fit = () => {
      const pad = 48;
      const availW = Math.max(1, wrap.clientWidth - pad);
      const availH = Math.max(1, wrap.clientHeight - pad);
      const scale = Math.min(availW / scene.width, availH / scene.height);
      canvas.style.width = `${Math.round(scene.width * scale)}px`;
      canvas.style.height = `${Math.round(scene.height * scale)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [scene.width, scene.height]);

  return (
    <div
      ref={wrapRef}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background:
          'repeating-conic-gradient(#191914 0% 25%, #14140f 0% 50%) 50% / 22px 22px',
      }}
    >
      <canvas ref={canvasRef} style={{ boxShadow: '0 8px 40px rgba(0,0,0,.5)' }} />
    </div>
  );
}
