import { DEFAULT_PALETTE, colorFor } from "./color";

/**
 * The look every preset draws with. Light and dark ship built in; anything can
 * be overridden by the `theme` prop, and every colour by a CSS variable, so a
 * kit theme (Tailwind v4 tokens, react-fancy's) can drive the graph:
 *
 *   --fancy-graph-background, --fancy-graph-link, --fancy-graph-label,
 *   --fancy-graph-label-halo, --fancy-focus, --fancy-graph-selection,
 *   --fancy-graph-type-<type>   (one per node type, e.g. --fancy-graph-type-agent)
 *
 * e.g. `.my-app { --fancy-graph-background: var(--color-zinc-950); }`.
 */
export interface GraphTheme {
  mode: "light" | "dark";
  background: string;
  link: string;
  label: string;
  labelHalo: string;
  focus: string;
  selection: string;
  /** Colours for node types with no explicit colour, assigned by a stable hash. */
  palette: readonly string[];
  /** Per-type colours, by node `group`. */
  typeColors: Readonly<Record<string, string>>;
}

export const LIGHT_THEME: Readonly<GraphTheme> = Object.freeze({
  mode: "light",
  background: "#f8fafc",
  link: "#64748b",
  label: "#0f172a",
  labelHalo: "#ffffff",
  focus: "#2563eb",
  selection: "#0f172a",
  palette: ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#65a30d", "#ea580c", "#c026d3"],
  typeColors: Object.freeze({}),
});

export const DARK_THEME: Readonly<GraphTheme> = Object.freeze({
  mode: "dark",
  background: "#0b1020",
  link: "#94a3b8",
  label: "#e8eef5",
  labelHalo: "#000000",
  focus: "#60a5fa",
  selection: "#f8fafc",
  palette: DEFAULT_PALETTE,
  typeColors: Object.freeze({}),
});

/** `"light"`, `"dark"`, `"auto"` (from a `.dark` / `[data-theme=dark]` ancestor, else the system), or overrides on a base. */
export type GraphThemeInput = "light" | "dark" | "auto" | (Partial<Omit<GraphTheme, "mode">> & { base?: "light" | "dark" | "auto" });

/** A CSS custom property, from the element up through its ancestors (inline or computed). */
export function cssVar(el: Element | null, name: string): string {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const inline = (e as HTMLElement).style?.getPropertyValue(name).trim();
    if (inline) return inline;
    if (typeof getComputedStyle === "function") {
      const computed = getComputedStyle(e).getPropertyValue(name).trim();
      if (computed) return computed;
    }
  }
  return "";
}

function prefersDark(el: Element | null): boolean {
  if (el?.closest?.('.dark, [data-theme="dark"]')) return true;
  if (el?.closest?.('.light, [data-theme="light"]')) return false;
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The theme to draw with: the base, the prop's overrides, then CSS variables on or above `el`. */
export function resolveTheme(input: GraphThemeInput | undefined, el: Element | null): GraphTheme {
  const spec = typeof input === "object" && input !== null ? input : { base: input ?? "auto" };
  const base = spec.base ?? "auto";
  const dark = base === "dark" || (base === "auto" && prefersDark(el));
  const t: GraphTheme = { ...(dark ? DARK_THEME : LIGHT_THEME) };
  for (const key of ["background", "link", "label", "labelHalo", "focus", "selection"] as const) {
    if (typeof spec[key] === "string") t[key] = spec[key] as string;
  }
  if (Array.isArray(spec.palette) && spec.palette.length) t.palette = spec.palette;
  t.typeColors = { ...(spec.typeColors ?? {}) };
  const vars: Record<string, keyof GraphTheme> = {
    "--fancy-graph-background": "background",
    "--fancy-graph-link": "link",
    "--fancy-graph-label": "label",
    "--fancy-graph-label-halo": "labelHalo",
    "--fancy-focus": "focus",
    "--fancy-graph-selection": "selection",
  };
  for (const [name, key] of Object.entries(vars)) {
    // The prop wins over the stylesheet; the stylesheet wins over the base.
    if (typeof spec[key as keyof typeof spec] === "string") continue;
    const v = cssVar(el, name);
    if (v) (t as unknown as Record<string, unknown>)[key] = v;
  }
  return t;
}

/** A node type's colour: the theme's map, then `--fancy-graph-type-<type>`, then the palette. */
export function typeColor(theme: GraphTheme, group: string | undefined, el: Element | null): string {
  if (group && theme.typeColors[group]) return theme.typeColors[group];
  if (group) {
    const v = cssVar(el, `--fancy-graph-type-${group.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
    if (v) return v;
  }
  return colorFor(group, theme.palette);
}

/** Sets the label colours on the root, so the label layer (pure CSS) follows the theme. */
export function applyThemeVars(el: HTMLElement | null, theme: GraphTheme): void {
  if (!el) return;
  el.style.setProperty("--fancy-graph-label", theme.label);
  el.style.setProperty("--fancy-graph-label-halo", theme.labelHalo);
}
