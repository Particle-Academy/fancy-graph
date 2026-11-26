import { normalizeGraph } from "../graph";
import { resolveLimits } from "../limits";
import type { IndexedGraph } from "../types";
import { createLayoutRunner, type GraphLayout, type GraphLayoutStepper, type LayoutEnv } from "./contract";
import { forceLayout, type ForceLayoutOptions } from "./force";
import { hierarchyLayout, radialLayout, type HierarchyLayoutOptions, type RadialLayoutOptions } from "./static";

/**
 * A built-in layout named by data, so it can cross a thread boundary.
 * Functions cannot be posted to a Worker; names and plain options can.
 */
export type BuiltinLayoutSpec =
  | { name: "force"; options?: ForceLayoutOptions }
  | { name: "radial"; options?: RadialLayoutOptions }
  | { name: "hierarchy"; options?: HierarchyLayoutOptions };

export function builtinLayout(spec: BuiltinLayoutSpec): GraphLayout | null {
  switch (spec?.name) {
    case "force":
      return forceLayout(spec.options);
    case "radial":
      return radialLayout(spec.options);
    case "hierarchy":
      return hierarchyLayout(spec.options);
    default:
      return null;
  }
}

/** The structural part of a Worker the client needs. A real `Worker` satisfies it. */
export interface LayoutWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  terminate(): void;
}

/** What crosses to the worker: ids and link endpoints only, never app data. */
export interface WorkerGraph {
  ids: string[];
  /** Pairs of node indices. */
  links: Int32Array;
  weights: Float32Array;
  fixed?: Float32Array;
}

export type ToWorker =
  | { type: "start"; id: number; layout: BuiltinLayoutSpec; graph: WorkerGraph; dimensions: 2 | 3 }
  | { type: "stop"; id: number };

export type FromWorker =
  | { type: "positions"; id: number; positions: Float32Array; settled: boolean }
  | { type: "error"; id: number; message: string };

export function toWorkerGraph(g: IndexedGraph): WorkerGraph {
  const links = new Int32Array(g.links.length * 2);
  const weights = new Float32Array(g.links.length);
  g.links.forEach((l, i) => {
    links[i * 2] = l.a;
    links[i * 2 + 1] = l.b;
    weights[i] = l.weight;
  });
  return { ids: g.nodes.map((n) => n.id), links, weights };
}

export function fromWorkerGraph(w: WorkerGraph): IndexedGraph {
  const ids = Array.isArray(w?.ids) ? w.ids.filter((id) => typeof id === "string") : [];
  const links = [];
  const pairs = w?.links instanceof Int32Array ? w.links : new Int32Array(0);
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const a = ids[pairs[i]], b = ids[pairs[i + 1]];
    if (a !== undefined && b !== undefined) links.push({ source: a, target: b, weight: w.weights?.[i / 2] ?? 1 });
  }
  return normalizeGraph({ nodes: ids.map((id) => ({ id })), links }, { maxNodes: Math.max(1, ids.length), maxLinks: Math.max(1, links.length) });
}

export interface WorkerLayoutOptions {
  /** Makes the worker, e.g. `() => new Worker(new URL("@particle-academy/fancy-graph/worker", import.meta.url), { type: "module" })`. */
  createWorker?: () => LayoutWorkerLike;
  /** Node count at or above which the worker is used. Defaults to `limits.workerThreshold`. */
  threshold?: number;
}

let nextId = 1;

/**
 * Runs a built-in layout in a Worker when the graph is large enough, and on
 * the main thread otherwise (or when no worker factory is given, or under
 * reduced motion, where the layout must settle before first paint). The view
 * cannot tell the difference: positions stream back through the same
 * layout contract.
 */
export function workerLayout(spec: BuiltinLayoutSpec, opts: WorkerLayoutOptions = {}): GraphLayoutStepper {
  let inline: ReturnType<typeof createLayoutRunner> | null = null;
  let worker: LayoutWorkerLike | null = null;
  let latest: Float32Array | null = null;
  let remoteSettled = false;
  let applied = false;
  let failed: string | null = null;
  const id = nextId++;

  return {
    name: `worker:${spec.name}`,
    init(graph, positions, env: LayoutEnv) {
      const threshold = opts.threshold ?? env.limits.workerThreshold;
      const useWorker = !!opts.createWorker && !env.reducedMotion && graph.nodes.length >= threshold;
      if (!useWorker) {
        const layout = builtinLayout(spec);
        if (!layout) throw new Error(`Unknown built-in layout: ${String((spec as { name?: unknown })?.name)}`);
        inline = createLayoutRunner(layout, graph, { ...env, limits: env.limits ?? resolveLimits() });
        positions.set(inline.positions);
        return;
      }
      worker = opts.createWorker!();
      worker.onmessage = (e) => {
        const m = e.data as FromWorker;
        if (!m || m.id !== id) return;
        if (m.type === "positions" && m.positions instanceof Float32Array && m.positions.length === positions.length) {
          latest = m.positions;
          remoteSettled = m.settled;
          applied = false;
        } else if (m.type === "error") {
          failed = m.message;
        }
      };
      const message: ToWorker = { type: "start", id, layout: spec, graph: toWorkerGraph(graph), dimensions: env.dimensions };
      worker.postMessage(message);
    },
    isSettled() {
      return !!inline?.settled;
    },
    step(positions) {
      if (inline) {
        const changed = inline.tick(1 / 60);
        if (changed) positions.set(inline.positions);
        return !inline.settled;
      }
      if (failed) return false;
      if (latest && !applied) {
        positions.set(latest);
        applied = true;
      }
      return !(remoteSettled && applied);
    },
    dispose() {
      inline?.dispose();
      if (worker) {
        worker.postMessage({ type: "stop", id } satisfies ToWorker);
        worker.terminate();
        worker.onmessage = null;
      }
    },
  };
}
