import { describe, expect, it } from "vitest";
import { createLayoutRunner, normalizeGraph, resolveLimits, workerLayout, type LayoutWorkerLike } from "../src/core";
import { attachLayoutWorker, type LayoutWorkerScope } from "../src/worker";

const graph = (n: number) =>
  normalizeGraph({ nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}` })), links: Array.from({ length: n - 1 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` })) });
const env = { dimensions: 2 as const, reducedMotion: false, limits: resolveLimits({ workerThreshold: 10 }) };

/** An in-process worker: the real worker module on one side, the client on the other. */
function fakeWorker() {
  const sent: unknown[] = [];
  let toClient: ((e: { data: unknown }) => void) | null = null;
  const scope: LayoutWorkerScope = {
    postMessage: (data) => queueMicrotask(() => toClient?.({ data })),
    onmessage: null,
  };
  attachLayoutWorker(scope);
  let terminated = false;
  const worker: LayoutWorkerLike = {
    postMessage(data) {
      sent.push(data);
      queueMicrotask(() => scope.onmessage?.({ data } as MessageEvent));
    },
    set onmessage(fn: ((e: { data: unknown }) => void) | null) {
      toClient = fn;
    },
    get onmessage() {
      return toClient;
    },
    terminate() {
      terminated = true;
    },
  };
  return { worker, sent, get terminated() { return terminated; } };
}

const flush = async (times = 50) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("workerLayout", () => {
  // Generous timeout: it drains hundreds of macrotasks, which a loaded runner slows a lot.
  it("runs a built-in layout off the main thread and streams positions back", { timeout: 20_000 }, async () => {
    const fake = fakeWorker();
    const r = createLayoutRunner(workerLayout({ name: "force", options: { seed: 1, iterations: 60 } }, { createWorker: () => fake.worker }), graph(40), env);
    expect(fake.sent[0]).toMatchObject({ type: "start" });
    await flush(400);
    r.tick(0.016);
    expect([...r.positions].some((v) => v !== 0)).toBe(true);
    expect([...r.positions].every(Number.isFinite)).toBe(true);
    expect(r.settled).toBe(true);
  });

  it("gives the same result as the inline layout", async () => {
    const fake = fakeWorker();
    const off = createLayoutRunner(workerLayout({ name: "radial", options: { ringGap: 50 } }, { createWorker: () => fake.worker }), graph(30), env);
    await flush();
    off.tick(0.016);
    const inline = createLayoutRunner(workerLayout({ name: "radial", options: { ringGap: 50 } }), graph(30), env);
    expect([...off.positions]).toEqual([...inline.positions]);
  });

  it("runs inline below the threshold, and without a worker factory", () => {
    let made = 0;
    const small = createLayoutRunner(workerLayout({ name: "hierarchy" }, { createWorker: () => { made++; return fakeWorker().worker; } }), graph(5), env);
    expect(made).toBe(0);
    expect(small.settled).toBe(true);
  });

  it("terminates the worker on dispose", async () => {
    const fake = fakeWorker();
    const r = createLayoutRunner(workerLayout({ name: "force" }, { createWorker: () => fake.worker }), graph(40), env);
    r.dispose();
    expect(fake.terminated).toBe(true);
  });

  it("refuses an unknown layout name in the worker rather than running something else", async () => {
    const replies: unknown[] = [];
    const scope: LayoutWorkerScope = { postMessage: (d) => replies.push(d), onmessage: null };
    attachLayoutWorker(scope);
    scope.onmessage?.({ data: { type: "start", id: 1, layout: { name: "eval" }, graph: { ids: ["a"], links: new Int32Array(0), weights: new Float32Array(0) }, dimensions: 2 } } as MessageEvent);
    await flush(2);
    expect(replies[0]).toMatchObject({ type: "error", id: 1 });
  });
});
