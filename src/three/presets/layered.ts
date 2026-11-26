import type { GraphLayoutStepper } from "../../layout/contract";
import type { GraphCluster, GraphNode, IndexedGraph, Vec3 } from "../../types";
import { createInstancedLayer } from "../layers";
import type { GraphLayer3D, LayerFrame3D } from "../types";

/** What separates the layers: the node type, a field bucketed over its range (numbers or dates), or your own key. */
export type LayerBy = "group" | { field: string; buckets?: number } | ((node: GraphNode) => string);

export interface LayeredLayoutOptions {
  /** Default `"group"`. */
  layerBy?: LayerBy;
  /** Distance between layers. Default 90. */
  gap?: number;
  /** Spacing between nodes inside a layer. Default 26. */
  spacing?: number;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function fieldValue(node: GraphNode, field: string): { value: number; date: boolean } | null {
  const raw = node.data?.[field] ?? (node as unknown as Record<string, unknown>)[field];
  if (typeof raw === "number" && Number.isFinite(raw)) return { value: raw, date: false };
  if (typeof raw === "string") {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return { value: t, date: true };
    const n = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(n)) return { value: n, date: false };
  }
  return null;
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Horizontal planes, one per layer, first layer on top: nodes of a type (or of
 * a time bucket) share a plane; inside it the best-connected sit at the centre
 * on a sunflower spiral. Links cross between planes, so dependencies and
 * hand-offs read top to bottom. Static: no physics, the same every load.
 */
export function layeredLayout(options: LayeredLayoutOptions = {}): GraphLayoutStepper {
  const gap = options.gap ?? 90;
  const spacing = options.spacing ?? 26;
  const layerBy = options.layerBy ?? "group";
  let layers: { id: string; label: string; members: number[]; y: number; radius: number }[] = [];

  return {
    name: "layered",
    init(graph: IndexedGraph, out: Float32Array) {
      const n = graph.nodes.length;
      const keyOf: string[] = new Array(n);
      const labels = new Map<string, string>();
      let order: string[];

      if (typeof layerBy === "object") {
        const buckets = Math.max(1, Math.floor(layerBy.buckets ?? 6));
        const values = graph.nodes.map((node) => fieldValue(node, layerBy.field));
        const known = values.filter((v): v is { value: number; date: boolean } => v !== null);
        const min = Math.min(...known.map((v) => v.value));
        const max = Math.max(...known.map((v) => v.value));
        const width = known.length ? Math.max(1e-9, (max - min) / buckets) : 1;
        const dates = known.length > 0 && known.every((v) => v.date);
        order = [];
        for (let b = 0; b < buckets; b++) {
          const lo = min + b * width;
          const hi = b === buckets - 1 ? max : min + (b + 1) * width;
          const id = `layer-${b}`;
          order.push(id);
          labels.set(id, dates ? `${day(lo)} – ${day(hi)}` : `${+lo.toPrecision(4)} – ${+hi.toPrecision(4)}`);
        }
        values.forEach((v, i) => {
          keyOf[i] = v === null ? "layer-unknown" : `layer-${Math.min(buckets - 1, Math.floor((v.value - min) / width))}`;
        });
        if (values.some((v) => v === null)) {
          order.push("layer-unknown");
          labels.set("layer-unknown", `no ${layerBy.field}`);
        }
      } else {
        const key = typeof layerBy === "function" ? layerBy : (node: GraphNode) => node.group ?? "other";
        const counts = new Map<string, number>();
        graph.nodes.forEach((node, i) => {
          keyOf[i] = String(key(node));
          counts.set(keyOf[i], (counts.get(keyOf[i]) ?? 0) + 1);
        });
        // Biggest layer first, then by name: stable whatever the input order.
        order = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
        order.forEach((k) => labels.set(k, k));
      }

      const members = new Map<string, number[]>(order.map((k) => [k, []]));
      for (let i = 0; i < n; i++) members.get(keyOf[i])?.push(i);
      layers = order
        .map((id, k) => {
          const list = (members.get(id) ?? []).sort((a, b) => graph.degree[b] - graph.degree[a] || a - b);
          const y = -k * gap;
          list.forEach((node, j) => {
            const r = spacing * Math.sqrt(j + 0.5);
            const a = j * GOLDEN;
            out[node * 3] = r * Math.cos(a);
            out[node * 3 + 1] = y;
            out[node * 3 + 2] = r * Math.sin(a);
          });
          return { id, label: labels.get(id) ?? id, members: list, y, radius: spacing * Math.sqrt(list.length + 1) + spacing };
        })
        .filter((l) => l.members.length > 0);
    },
    clusters(): GraphCluster[] {
      return layers.map((l) => ({ id: l.id, label: l.label, center: [0, l.y, 0] as Vec3, radius: l.radius, members: l.members, normal: [0, 1, 0] as Vec3 }));
    },
  };
}

const PLANE_VS = /* glsl */ `
in vec3 position; in vec3 iCenter; in float iRadius; in vec3 iColor;
uniform mat4 viewMatrix, projectionMatrix;
out vec2 vUv; out vec3 vColor;
void main(){
  vUv = position.xy; vColor = iColor;
  vec3 w = iCenter + vec3(position.x, 0., position.y) * iRadius;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
}`;

const PLANE_FS = /* glsl */ `
precision highp float;
in vec2 vUv; in vec3 vColor; uniform float uOpacity; out vec4 o;
void main(){
  float r = length(vUv);
  if (r > 1.) discard;
  float fill = (1. - smoothstep(.6, 1., r)) * uOpacity;
  float rim = smoothstep(.03, 0., abs(r - .985)) * .5;
  o = vec4(vColor * (fill + rim), 0.);
}`;

/** One translucent disc per layer, in its members' colour. */
export function layerPlanes(opacity = 0.18): GraphLayer3D {
  return createInstancedLayer({
    name: "fancy-graph-layer-planes",
    source: "clusters",
    vertexShader: PLANE_VS,
    fragmentShader: PLANE_FS,
    uniforms: { uOpacity: { value: opacity } },
    blending: "premultiplied",
    // Mapping the quad from xy into the xz plane flips its winding seen from above: draw both sides.
    side: "double",
    attributes: [{ name: "iCenter", size: 3 }, { name: "iRadius", size: 1 }, { name: "iColor", size: 3 }],
    write(out: Float32Array, at: number, i: number, f: LayerFrame3D) {
      const c = f.clusters[i];
      const m = c.members[0] ?? -1;
      out.set(c.center, at);
      out[at + 3] = c.radius;
      out[at + 4] = m >= 0 ? f.colors[m * 3] : 0.6;
      out[at + 5] = m >= 0 ? f.colors[m * 3 + 1] : 0.6;
      out[at + 6] = m >= 0 ? f.colors[m * 3 + 2] : 0.6;
    },
  });
}
