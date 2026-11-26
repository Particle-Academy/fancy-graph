import type { GraphLimits } from "./limits";
import type { Vec3 } from "./types";

/** The 2D view: the world point at the centre of the viewport, and px per world unit. */
export interface Camera2D {
  x: number;
  y: number;
  zoom: number;
}

/** The 3D view: an orbit about `target`. yaw about +y from +z, pitch up from the horizon (radians). */
export interface Camera3D {
  target: Vec3;
  distance: number;
  yaw: number;
  pitch: number;
}

export function worldToScreen2D(c: Camera2D, w: number, h: number, x: number, y: number): [number, number] {
  return [(x - c.x) * c.zoom + w / 2, (y - c.y) * c.zoom + h / 2];
}

export function screenToWorld2D(c: Camera2D, w: number, h: number, sx: number, sy: number): [number, number] {
  return [(sx - w / 2) / c.zoom + c.x, (sy - h / 2) / c.zoom + c.y];
}

export function clampCamera2D(c: Camera2D, limits: Pick<GraphLimits, "minZoom" | "maxZoom">): Camera2D {
  const zoom = Math.min(limits.maxZoom, Math.max(limits.minZoom, Number.isFinite(c.zoom) && c.zoom > 0 ? c.zoom : 1));
  return { x: Number.isFinite(c.x) ? c.x : 0, y: Number.isFinite(c.y) ? c.y : 0, zoom };
}

/** Zooms by `factor` about a screen point, which stays under the cursor. */
export function zoomAt2D(c: Camera2D, w: number, h: number, sx: number, sy: number, factor: number, limits: Pick<GraphLimits, "minZoom" | "maxZoom">): Camera2D {
  const [wx, wy] = screenToWorld2D(c, w, h, sx, sy);
  const zoom = clampCamera2D({ ...c, zoom: c.zoom * factor }, limits).zoom;
  return { zoom, x: wx - (sx - w / 2) / zoom, y: wy - (sy - h / 2) / zoom };
}

/** A camera that fits `indices` (or every node) into the viewport, inside `padding` px. */
export function fitCamera2D(positions: Float32Array, indices: ArrayLike<number> | null, w: number, h: number, padding: number, limits: Pick<GraphLimits, "minZoom" | "maxZoom">): Camera2D {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const count = indices ? indices.length : positions.length / 3;
  for (let k = 0; k < count; k++) {
    const i = indices ? indices[k] : k;
    const x = positions[i * 3], y = positions[i * 3 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, zoom: 1 };
  const bw = Math.max(1e-6, maxX - minX), bh = Math.max(1e-6, maxY - minY);
  const zoom = Math.min((w - padding * 2) / bw, (h - padding * 2) / bh);
  const single = maxX - minX < 1e-6 && maxY - minY < 1e-6;
  return clampCamera2D({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom: single ? 1 : zoom }, limits);
}

/** Interpolates two cameras; zoom moves in log space so a fly feels even. */
export function lerpCamera2D(a: Camera2D, b: Camera2D, t: number): Camera2D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    zoom: Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * t),
  };
}

/** The eye position for an orbit camera. */
export function orbitPosition(c: Camera3D): Vec3 {
  const cp = Math.cos(c.pitch);
  return [c.target[0] + c.distance * cp * Math.sin(c.yaw), c.target[1] + c.distance * Math.sin(c.pitch), c.target[2] + c.distance * cp * Math.cos(c.yaw)];
}

/** The orbit camera for an eye and a target. */
export function orbitFrom(eye: Vec3, target: Vec3): Camera3D {
  const dx = eye[0] - target[0], dy = eye[1] - target[1], dz = eye[2] - target[2];
  const distance = Math.hypot(dx, dy, dz) || 1;
  return { target: [...target] as Vec3, distance, yaw: Math.atan2(dx, dz), pitch: Math.asin(Math.max(-1, Math.min(1, dy / distance))) };
}
