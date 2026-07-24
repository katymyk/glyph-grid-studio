import { Slider } from '@base-ui/react/slider';
import { Field } from './Field';
import styles from './ui.module.css';

/** Label + value readout + Base UI slider — the workhorse numeric control. */
export function ControlSlider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} value={format ? format(value) : value}>
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
