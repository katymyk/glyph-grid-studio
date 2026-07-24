/** Font stacks (ported from v1). ABC Diatype is referenced, never bundled. */
export const FONT_STACKS: Record<string, string> = {
  mono: '"ABC Diatype Mono","SFMono-Regular",ui-monospace,Menlo,Consolas,monospace',
  sans: '"ABC Diatype","Helvetica Neue",Arial,sans-serif',
  fallmono: 'ui-monospace,Menlo,Consolas,monospace',
  fallsans: 'Arial,Helvetica,sans-serif',
  serif: 'Georgia,"Times New Roman",serif',
};

export function fontStack(key: string): string {
  return FONT_STACKS[key] ?? FONT_STACKS.mono;
}
