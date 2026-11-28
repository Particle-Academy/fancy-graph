/**
 * A synthetic graph shaped like the kit dependency map, the cosmos's first real
 * use: packages with a `language` (one, or several for a polyglot), a `family`,
 * the `features` they serve and a `releasedAt` date, joined by dependency links.
 * Seeded, so every run sees the same graph. Not shipped.
 */
import { seeded, type GraphData, type GraphLink, type GraphNode } from "../../src/core";

export const KIT_LANGUAGES = ["typescript", "php", "python"];
export const KIT_FAMILIES = ["surfaces", "documents", "commerce", "engines", "tooling"];
export const KIT_FEATURES = ["ai", "3d", "documents", "payments", "search"];
export const KIT_NOW = "2026-11-27T00:00:00Z";

const WORDS = ["sheet", "slide", "flow", "graph", "map", "code", "term", "diff", "pixel", "query", "seo", "cms", "git", "pwa", "mlm", "sign", "fun", "word", "echo", "relay"];

export function kitData(count = 60, seed = 3): GraphData {
  const rand = seeded(seed / 101 + 0.37);
  const nodes: GraphNode[] = [];
  const now = Date.parse(KIT_NOW);
  for (let i = 0; i < count; i++) {
    const lang = KIT_LANGUAGES[i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0];
    // Every ninth package ships in two languages: a polyglot.
    const language = i % 9 === 4 ? [lang, KIT_LANGUAGES[(KIT_LANGUAGES.indexOf(lang) + 1) % 3]] : lang;
    const features = KIT_FEATURES.filter((_, k) => (i + k * 3) % 5 === 0 || (k === 0 && i % 4 === 1));
    nodes.push({
      id: `pkg-${i}`,
      label: `fancy-${WORDS[i % WORDS.length]}${i >= WORDS.length ? `-${Math.floor(i / WORDS.length)}` : ""}`,
      group: "package",
      data: {
        language,
        family: KIT_FAMILIES[Math.floor(rand() * KIT_FAMILIES.length)],
        features,
        releasedAt: new Date(now - Math.floor(i * 2.5 + rand() * 2) * 86400000).toISOString(),
      },
    });
  }
  const links: GraphLink[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < count; i++) {
    const deps = 1 + Math.floor(rand() * 3);
    for (let d = 0; d < deps; d++) {
      const j = Math.floor(Math.pow(rand(), 1.8) * i);
      const key = `${i}:${j}`;
      if (j === i || seen.has(key)) continue;
      seen.add(key);
      links.push({ source: `pkg-${i}`, target: `pkg-${j}`, kind: rand() < 0.2 ? "peer" : "depends-on", weight: 1 + Math.floor(rand() * 2) });
    }
  }
  return { nodes, links };
}

/**
 * The same idea with explicit relations instead of fields: languages are real
 * nodes that sit in a "languages" galaxy, packages are `written-in` a language,
 * and a few packages have `part-of` sub-packages (moons).
 */
export function relationData(): GraphData {
  const nodes: GraphNode[] = [
    { id: "languages", label: "languages", group: "category" },
    { id: "runtimes", label: "runtimes", group: "category" },
    { id: "typescript", label: "typescript", group: "language" },
    { id: "php", label: "php", group: "language" },
    { id: "python", label: "python", group: "language" },
    { id: "node", label: "node", group: "runtime" },
  ];
  const links: GraphLink[] = [
    { source: "typescript", target: "languages", kind: "member-of" },
    { source: "php", target: "languages", kind: "member-of" },
    { source: "python", target: "languages", kind: "member-of" },
    { source: "node", target: "runtimes", kind: "member-of" },
  ];
  const langs = ["typescript", "typescript", "typescript", "php", "php", "python"];
  for (let i = 0; i < 18; i++) {
    const id = `p${i}`;
    nodes.push({ id, label: `package ${i}`, group: "package" });
    links.push({ source: id, target: langs[i % langs.length], kind: "written-in" });
    if (i % 4 === 0) {
      for (let k = 0; k < 2; k++) {
        nodes.push({ id: `${id}-m${k}`, label: `${id} part ${k}`, group: "module" });
        links.push({ source: `${id}-m${k}`, target: id, kind: "part-of" });
      }
    }
    if (i > 0) links.push({ source: id, target: `p${(i * 7 + 3) % i}`, kind: "depends-on" });
  }
  links.push({ source: "p1", target: "node", kind: "depends-on" });
  return { nodes, links };
}
