import type { GraphLimits } from "../limits";
import type { GraphCluster, IndexedGraph } from "../types";

export interface LayoutEnv {
  dimensions: 2 | 3;
  limits: GraphLimits;
  /** True when the person asked for reduced motion. Physics settles before first paint; animated time is frozen. */
  reducedMotion: boolean;
}

export interface LayoutFrame {
  /** Seconds of animated time, frozen while paused or under reduced motion. */
  time: number;
  /** Seconds since the previous step. */
  dt: number;
}

/**
 * A layout that runs over time. `init` writes starting positions; `step` is
 * called once per frame and writes new ones, returning `true` while it is still
 * moving. Positions are a flat `Float32Array`, 3 floats per node (z is 0 in 2D).
 */
export interface GraphLayoutStepper {
  name?: string;
  /** Positions change every frame forever (orbits, timelines). The view never idles. */
  animated?: boolean;
  init(graph: IndexedGraph, positions: Float32Array, env: LayoutEnv): void;
  step?(positions: Float32Array, frame: LayoutFrame): boolean | void;
  /** Read once after `init`: true when there is nothing left to step (a wrapper whose work already finished). */
  isSettled?(): boolean;
  /** Clusters this layout knows about (galaxies, communities), in world space. */
  clusters?(positions: Float32Array): GraphCluster[];
  /** Anything the layout wants its renderers to read: star/planet kinds, orbit planes. */
  meta?: unknown;
  dispose?(): void;
}

/** A layout that places every node once. */
export type GraphLayoutFunction = (graph: IndexedGraph, positions: Float32Array, env: LayoutEnv) => void;

export type GraphLayout = GraphLayoutStepper | GraphLayoutFunction;

export interface LayoutRunner {
  readonly positions: Float32Array;
  readonly settled: boolean;
  readonly animated: boolean;
  readonly meta: unknown;
  readonly time: number;
  /** Advances one frame. Returns true when positions changed. */
  tick(dt: number): boolean;
  clusters(): GraphCluster[] | null;
  setPaused(paused: boolean): void;
  dispose(): void;
}

/**
 * Drives any layout through the contract, so the view treats a function, a
 * physics stepper, an orbiting cosmos and an off-thread worker the same way.
 */
export function createLayoutRunner(layout: GraphLayout, graph: IndexedGraph, env: LayoutEnv): LayoutRunner {
  const n = graph.nodes.length;
  const positions = new Float32Array(n * 3);
  const stepper: GraphLayoutStepper = typeof layout === "function" ? { init: (g, p, e) => layout(g, p, e) } : layout;
  const fixed: number[] = [];
  graph.nodes.forEach((node, i) => {
    if (node.fixed && Number.isFinite(node.x) && Number.isFinite(node.y)) fixed.push(i);
  });
  const pin = () => {
    for (const i of fixed) {
      const node = graph.nodes[i];
      positions[i * 3] = node.x!;
      positions[i * 3 + 1] = node.y!;
      positions[i * 3 + 2] = env.dimensions === 3 && Number.isFinite(node.z) ? node.z! : 0;
    }
  };

  stepper.init(graph, positions, env);
  pin();
  const animated = !!stepper.animated;
  let settled = !stepper.step || stepper.isSettled?.() === true;
  let paused = false;
  let time = 0;

  if (!settled && env.reducedMotion) {
    if (animated) {
      stepper.step!(positions, { time: 0, dt: 0 });
      pin();
    } else {
      for (let k = 0; k < env.limits.maxSettleTicks; k++) {
        const moving = stepper.step!(positions, { time: 0, dt: 1 / 60 });
        if (moving === false || moving === undefined) {
          settled = true;
          break;
        }
      }
      pin();
      settled = true;
    }
  }

  return {
    positions,
    get settled() {
      return settled && !animated;
    },
    animated,
    get meta() {
      return stepper.meta;
    },
    get time() {
      return time;
    },
    tick(dt) {
      if (!stepper.step) return false;
      if (animated) {
        if (env.reducedMotion || paused) return false;
        time += dt;
        stepper.step(positions, { time, dt });
        pin();
        return true;
      }
      if (settled || paused) return false;
      const moving = stepper.step(positions, { time, dt });
      time += dt;
      pin();
      if (moving === false || moving === undefined) settled = true;
      return true;
    },
    clusters() {
      return stepper.clusters ? stepper.clusters(positions) : null;
    },
    setPaused(p) {
      paused = p;
    },
    dispose() {
      stepper.dispose?.();
    },
  };
}
