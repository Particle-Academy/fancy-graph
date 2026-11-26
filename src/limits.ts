/**
 * Every limit the kit applies, in one place, and every one configurable through
 * the `limits` prop. The defaults are the measured comfortable range (see the
 * README's benchmark section), not hard ceilings.
 */
export interface GraphLimits {
  /** Nodes beyond this are dropped (first come, first kept). */
  maxNodes: number;
  /** Links beyond this are dropped, weakest first. */
  maxLinks: number;
  /** Node labels on screen at once. */
  maxLabels: number;
  /** Labels that must show (selection, hover, the focused node and its neighbours), even past maxLabels. */
  maxForcedLabels: number;
  /** Characters per label before it is cut with an ellipsis. */
  maxLabelLength: number;
  /** Projected radius (CSS px) a node needs before its label competes for space. */
  labelMinPx: number;
  /** Minimum pick reach (CSS px), so tiny nodes stay clickable. */
  pickRadius: number;
  /** Search results kept and highlighted. */
  maxSearchResults: number;
  /** Node count above which `workerLayout` moves a built-in layout off the main thread. */
  workerThreshold: number;
  /** Steps a layout may take to settle before first paint under reduced motion. */
  maxSettleTicks: number;
  /** Device pixel ratio cap for the canvas. */
  maxPixelRatio: number;
  /** 2D zoom range. */
  minZoom: number;
  maxZoom: number;
  /** 3D camera distance range, as multiples of the graph's extent. */
  maxDistanceFactor: number;
  minDistance: number;
}

export const DEFAULT_LIMITS: Readonly<GraphLimits> = Object.freeze({
  maxNodes: 20000,
  maxLinks: 60000,
  maxLabels: 40,
  maxForcedLabels: 64,
  maxLabelLength: 48,
  labelMinPx: 3.5,
  pickRadius: 7,
  maxSearchResults: 500,
  workerThreshold: 1500,
  maxSettleTicks: 600,
  maxPixelRatio: 2,
  minZoom: 0.01,
  maxZoom: 40,
  maxDistanceFactor: 4,
  minDistance: 2,
});

/** Overrides merged onto the defaults. A non-finite or non-positive override is ignored, never "unlimited". */
export function resolveLimits(overrides?: Partial<GraphLimits> | null): GraphLimits {
  const out = { ...DEFAULT_LIMITS } as GraphLimits;
  if (!overrides) return out;
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof GraphLimits)[]) {
    const v = overrides[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[key] = v;
  }
  return out;
}

/** Cuts a label to `max` characters, ending in an ellipsis when it was cut. */
export function truncateLabel(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}
