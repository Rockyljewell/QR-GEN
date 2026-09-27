/**
 * Tiny color helper for the overlay. Pure TypeScript.
 */

/**
 * Returns `color` with the given alpha (0..1) as an `rgba()` string. Accepts
 * `#RGB`, `#RGBA`, `#RRGGBB` and `#RRGGBBAA`. Other formats are returned
 * unchanged, which keeps named or `rgb()` colors working (without the alpha).
 */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim());
  if (!m) return color;
  let hex = m[1]!;
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}
