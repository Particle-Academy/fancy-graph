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
    glob(pattern: string | string[], options: { query: "?raw"; import: "default"; eager: true }): Record<string, string>;
  }
}

const SOURCES = import.meta.glob("../src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
// Everything else that ships in the repo: tests, the cosmos example and the bench harness.
const OTHERS = import.meta.glob(["../tests/**/*.{ts,tsx}", "../examples/**/*.ts", "../bench/**/*.{ts,tsx,mjs}"], { query: "?raw", import: "default", eager: true });
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

  it("the ./three entry reaches three only through fancy-3d-three", () => {
    const { bare } = reachable("src/three/index.ts");
    expect([...bare]).toContain("@particle-academy/fancy-3d-three/three");
    expect([...bare]).toContain("@particle-academy/fancy-3d-three/react");
    expect([...bare].filter((s) => s === "three" || s.startsWith("three/"))).toEqual([]);
  });

  it("no file in the repo imports three directly (src, tests, examples, bench)", () => {
    expect(Object.keys(OTHERS).length).toBeGreaterThan(10);
    const direct = Object.entries({ ...SOURCES, ...OTHERS })
      .filter(([, src]) => [...src.matchAll(IMPORT)].some((m) => {
        const spec = m[1] ?? m[2];
        return spec === "three" || spec.startsWith("three/");
      }))
      .map(([file]) => file);
    expect(direct).toEqual([]);
  });

  it("the root entry re-exports the whole core", () => {
    expect(Object.keys(root)).toEqual(expect.arrayContaining(Object.keys(core)));
  });

  it.each(["src/index.ts", "src/core.ts", "src/worker.ts", "src/three/index.ts"])("%s never reaches react-fancy (only ./controls may)", (entry) => {
    const { bare } = reachable(entry);
    expect([...bare].filter((s) => s.startsWith("@particle-academy/react-fancy"))).toEqual([]);
  });

  it("the ./controls entry is built from react-fancy, and react-fancy is an optional peer", () => {
    const { bare } = reachable("src/controls/index.ts");
    expect([...bare].some((s) => s.startsWith("@particle-academy/react-fancy"))).toBe(true);
    const p = pkg as { peerDependencies?: Record<string, string>; peerDependenciesMeta: Record<string, { optional?: boolean }>; exports: Record<string, unknown> };
    expect(p.peerDependencies?.["@particle-academy/react-fancy"]).toMatch(/^>=5\.13\.0/);
    expect(p.peerDependenciesMeta["@particle-academy/react-fancy"].optional).toBe(true);
    expect(Object.keys(p.exports)).toContain("./controls");
  });

  it("has no three dependency of any kind: 3D comes only through fancy-3d-three, an optional peer", () => {
    type Deps = Record<string, string> | undefined;
    const p = pkg as { dependencies?: Deps; devDependencies?: Deps; peerDependencies?: Deps; optionalDependencies?: Deps; peerDependenciesMeta: Record<string, { optional?: boolean }> };
    expect(p.dependencies ?? {}).toEqual({});
    for (const field of [p.devDependencies, p.peerDependencies, p.optionalDependencies]) expect(Object.keys(field ?? {})).not.toContain("three");
    expect(Object.keys(p.peerDependenciesMeta)).not.toContain("three");
    expect(p.peerDependencies?.["@particle-academy/fancy-3d-three"]).toMatch(/^>=0\.3\.0/);
    expect(p.peerDependenciesMeta["@particle-academy/fancy-3d-three"].optional).toBe(true);
  });
});
