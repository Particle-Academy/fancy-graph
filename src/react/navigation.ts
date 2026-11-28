import { cycleNeighbor, neighborLinks, stepInDirection, type StepDirection } from "../interaction";
import type { IndexedGraph } from "../types";

/** Where link cycling is: the node whose links are being walked, and the position in them. */
export interface CycleState {
  anchor: number;
  position: number;
}

export const freshCycle = (): CycleState => ({ anchor: -1, position: -1 });

/**
 * A focus change asked for but not yet rendered. A gamepad can step twice in
 * one tick; the second step must start where the first one went, not where the
 * last render left the focus. Cleared after every commit.
 */
export interface PendingFocus {
  id: string | null;
  /** The rendered focus when the change was asked for. */
  from: string | null;
}

/** The focus a step should start from: the pending one while the render has not caught up. */
export function effectiveFocus(rendered: string | null, pending: PendingFocus | null): string | null {
  return pending && pending.from === rendered ? pending.id : rendered;
}

/**
 * One gamepad / keyboard step. With nothing focused, focus lands on the
 * selection, else on the best-connected input node (never a synthetic centre
 * while there is an input node). Directions follow links on
 * screen; next / previous walk the anchor's links in their stable order, where
 * the anchor is the node focused when cycling began. Returns the node index to
 * focus (unchanged when there is nowhere to go).
 */
export function stepFocusIndex(graph: IndexedGraph, cycle: CycleState, focused: number, selected: number, dir: StepDirection, screen: Float32Array): number {
  const n = graph.nodes.length;
  if (!n) return -1;
  if (focused < 0 || focused >= n) {
    cycle.anchor = cycle.position = -1;
    if (selected >= 0 && selected < n) return selected;
    let best = -1;
    for (let i = 0; i < n; i++) if (graph.nodes[i].synthetic !== true && (best < 0 || graph.degree[i] > graph.degree[best])) best = i;
    return best >= 0 ? best : 0;
  }
  if (dir === "next" || dir === "previous") {
    const links = cycle.anchor >= 0 ? neighborLinks(graph, cycle.anchor) : [];
    const onCycle = cycle.position >= 0 && links[cycle.position]?.index === focused;
    if (!onCycle) {
      cycle.anchor = focused;
      cycle.position = -1;
    }
    const next = cycleNeighbor(graph, cycle.anchor, cycle.position, dir === "next" ? 1 : -1);
    if (!next) return focused;
    cycle.position = next.position;
    return next.index;
  }
  cycle.anchor = cycle.position = -1;
  const j = stepInDirection(graph, focused, dir, screen);
  return j >= 0 ? j : focused;
}
