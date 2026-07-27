import { Slider } from '@base-ui/react/slider';
import { Field } from './Field';
import { KeyToggle } from './KeyToggle';
import styles from './ui.module.css';

/** Label + value + Base UI slider. If onToggleAnimate is given, shows a keyframe
    diamond (filled when the param is animated). */
export function ControlSlider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
  animated,
  onToggleAnimate,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  animated?: boolean;
  onToggleAnimate?: () => void;
}) {
  const action = onToggleAnimate ? <KeyToggle animated={animated} onToggle={onToggleAnimate} /> : undefined;

  return (
    <Field label={label} value={format ? format(value) : Math.round(value)} action={action}>
      <Slider.Root
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      >
        <Slider.Control className={styles.sliderControl}>
          <Slider.Track className={styles.sliderTrack}>
            <Slider.Indicator className={styles.sliderIndicator} />
            <Slider.Thumb className={styles.sliderThumb} />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </Field>
  );
}
