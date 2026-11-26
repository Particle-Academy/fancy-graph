import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import * as core from "../src/core";
import * as root from "../src/index";

/**
 * `three` and fancy-3d-three are OPTIONAL peers. A 2D consumer must be able to
 * install fancy-graph without them, so nothing reachable from the core entries
 * may import either. This walks the real import graph from each entry rather
 * than trusting a list of files, so a new module cannot slip past it.
 *
 * Sources are read through Vite's import.meta.glob (raw), so the test needs no
 * Node typings.
 */
declare global {
  interface ImportMeta {
    glob(pattern: string, options: { query: "?raw"; import: "default"; eager: true }): Record<string, string>;
  }
}

const SOURCES = import.meta.glob("../src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
const IMPORT = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}

function resolveRelative(from: string, spec: string): string {
  const base = normalize(`${from.slice(0, from.lastIndexOf("/"))}/${spec}`);
  const hit = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((p) => SOURCES[`../${p}`] !== undefined);
  if (!hit) throw new Error(`${from} imports ${spec}, which does not resolve`);
  return hit;
}

function reachable(entry: string): { files: Set<string>; bare: Set<string> } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const src = SOURCES[`../${file}`];
    if (src === undefined) throw new Error(`no source for ${file}`);
    for (const m of src.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith(".")) visit(resolveRelative(file, spec));
      else bare.add(spec);
    }
  };
  visit(entry);
  return { files, bare };
}

describe("entry isolation", () => {
  it("sees the sources", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(10);
  });

  it.each(["src/index.ts", "src/core.ts", "src/worker.ts"])("%s pulls in neither three nor fancy-3d-three", (entry) => {
    const { files, bare } = reachable(entry);
    expect(files.size).toBeGreaterThan(1);
    const offenders = [...bare].filter((s) => s === "three" || s.startsWith("three/") || s.startsWith("@particle-academy/fancy-3d"));
    expect(offenders).toEqual([]);
  });

  it.each(["src/core.ts", "src/worker.ts"])("%s is headless: no React either", (entry) => {
    const { bare } = reachable(entry);
    expect([...bare].filter((s) => s === "react" || s.startsWith("react-dom") || s.startsWith("react/"))).toEqual([]);
  });

  it("only the ./three entry reaches three, and it does", () => {
    const { bare } = reachable("src/three/index.ts");
    expect([...bare]).toContain("three");
    expect([...bare]).toContain("@particle-academy/fancy-3d-three/react");
  });

  it("the root entry re-exports the whole core", () => {
    expect(Object.keys(root)).toEqual(expect.arrayContaining(Object.keys(core)));
  });

  it("declares three and fancy-3d-three as optional peers and has no runtime dependencies", () => {
    const p = pkg as { dependencies?: Record<string, string>; peerDependenciesMeta: Record<string, { optional?: boolean }> };
    expect(p.dependencies ?? {}).toEqual({});
    expect(p.peerDependenciesMeta.three.optional).toBe(true);
    expect(p.peerDependenciesMeta["@particle-academy/fancy-3d-three"].optional).toBe(true);
  });
});
