export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

/** Map a normalized progress 0..1 through an easing curve. */
export function ease(kind: Easing, t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  switch (kind) {
    case 'easeIn':
      return x * x;
    case 'easeOut':
      return 1 - (1 - x) * (1 - x);
    case 'easeInOut':
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    case 'linear':
    default:
      return x;
  }
}
