import { useEffect, useRef } from 'react';
import { paintScene } from '../engine/paint';
import { useStudio } from '../state/store';

/** The canvas surface. Backing store is always scene.width x height (full-res);
    CSS scales it to fit. Repaints whenever the scene or playhead changes. */
export function Stage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scene = useStudio((s) => s.scene);
  const playhead = useStudio((s) => s.playhead);
  const imageVersion = useStudio((s) => s.imageVersion);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== scene.width) canvas.width = scene.width;
    if (canvas.height !== scene.height) canvas.height = scene.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paintScene(ctx, scene, playhead);
  }, [scene, playhead, imageVersion]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        padding: 24,
        background:
          'repeating-conic-gradient(#191914 0% 25%, #14140f 0% 50%) 50% / 22px 22px',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          boxShadow: '0 8px 40px rgba(0,0,0,.5)',
        }}
      />
    </div>
  );
}
