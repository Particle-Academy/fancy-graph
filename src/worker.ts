/**
 * The layout worker. Load this module as a Worker and it runs built-in layouts
 * off the main thread:
 *
 *   const createWorker = () =>
 *     new Worker(new URL("@particle-academy/fancy-graph/worker", import.meta.url), { type: "module" });
 *   <GraphView layout={workerLayout({ name: "force" }, { createWorker })} />
 *
 * It only ever runs a layout chosen by NAME from the built-in set; a message
 * cannot make it run anything else.
 */
import { createLayoutRunner } from "./layout/contract";
import { builtinLayout, fromWorkerGraph, type FromWorker, type ToWorker } from "./layout/worker-layout";
import { resolveLimits } from "./limits";

export interface LayoutWorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

/** Wires the layout protocol onto a worker scope (`self` in a real worker). */
export function attachLayoutWorker(scope: LayoutWorkerScope, opts: { frameMs?: number } = {}): void {
  const frameMs = opts.frameMs ?? 16;
  const jobs = new Map<number, { stop: boolean }>();

  scope.onmessage = (event: MessageEvent) => {
    const m = event.data as ToWorker;
    if (!m || typeof m !== "object") return;
    if (m.type === "stop") {
      const job = jobs.get(m.id);
      if (job) job.stop = true;
      jobs.delete(m.id);
      return;
    }
    if (m.type !== "start") return;
    const reply = (r: FromWorker, transfer?: Transferable[]) => scope.postMessage(r, transfer);
    const layout = builtinLayout(m.layout);
    if (!layout) {
      reply({ type: "error", id: m.id, message: "Unknown built-in layout" });
      return;
    }
    const graph = fromWorkerGraph(m.graph);
    const runner = createLayoutRunner(layout, graph, { dimensions: m.dimensions === 3 ? 3 : 2, reducedMotion: false, limits: resolveLimits() });
    const job = { stop: false };
    jobs.set(m.id, job);
    const send = () => {
      const copy = runner.positions.slice();
      reply({ type: "positions", id: m.id, positions: copy, settled: runner.settled }, [copy.buffer]);
    };
    const run = () => {
      if (job.stop) return;
      const t0 = Date.now();
      // Step for one frame's worth of time, then post; the main thread never waits on us.
      while (!runner.settled && Date.now() - t0 < frameMs) runner.tick(1 / 60);
      send();
      if (!runner.settled) setTimeout(run, 0);
      else jobs.delete(m.id);
    };
    send();
    setTimeout(run, 0);
  };
}

declare const WorkerGlobalScope: (abstract new () => unknown) | undefined;
const scope: unknown = globalThis;
// Only self-install inside a real worker global, never when imported on a page or in tests.
if (typeof WorkerGlobalScope === "function" && scope instanceof WorkerGlobalScope) {
  attachLayoutWorker(scope as LayoutWorkerScope);
}
