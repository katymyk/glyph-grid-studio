import { useEffect } from 'react';
import { useStudio } from '../state/store';
import styles from '../ui/ui.module.css';

/** Playback transport: play/pause, scrubber, time readout, loop length. Drives
    the playhead, which the engine reads to resolve animated params. */
export function Transport() {
  const playing = useStudio((s) => s.playing);
  const playhead = useStudio((s) => s.playhead);
  const duration = useStudio((s) => s.scene.duration);
  const play = useStudio((s) => s.play);
  const pause = useStudio((s) => s.pause);
  const setPlayhead = useStudio((s) => s.setPlayhead);
  const setDuration = useStudio((s) => s.setDuration);

  // advance the playhead while playing, looping at duration
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const d = useStudio.getState().scene.duration || 0.1;
      let t = useStudio.getState().playhead + dt;
      if (t >= d) t %= d;
      setPlayhead(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, setPlayhead]);

  return (
    <div className={styles.transport}>
      <button className={styles.transportBtn} onClick={() => (playing ? pause() : play())}>
        {playing ? '⏸' : '▶'}
      </button>
      <input
        className={styles.transportRange}
        type="range"
        min={0}
        max={duration}
        step={0.01}
        value={playhead}
        onChange={(e) => {
          pause();
          setPlayhead(Number(e.target.value));
        }}
      />
      <span className={styles.transportTime}>
        {playhead.toFixed(1)} / {duration.toFixed(1)}s
      </span>
      <input
        className={styles.transportDur}
        type="number"
        min={0.1}
        step={0.5}
        value={duration}
        title="Loop length (seconds)"
        onChange={(e) => setDuration(Number(e.target.value))}
      />
    </div>
  );
}
