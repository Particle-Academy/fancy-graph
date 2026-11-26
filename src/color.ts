import { hash01 } from "./random";

/** Ten distinguishable hues that read on dark and light backgrounds. */
export const DEFAULT_PALETTE: readonly string[] = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#22d3ee", "#a3e635", "#fb923c", "#e879f9"];

/** A stable palette colour for a group key. */
export function colorFor(key: string | undefined, palette: readonly string[] = DEFAULT_PALETTE): string {
  if (!key) return "#94a3b8";
  return palette[Math.floor(hash01(key) * palette.length) % palette.length];
}

/** `#rgb` / `#rrggbb` to 0..1 rgb. Anything else is a neutral grey rather than an exception. */
export function parseColor(css: string | undefined): [number, number, number] {
  const m = typeof css === "string" ? /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim()) : null;
  if (!m) return [0.58, 0.64, 0.72];
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
