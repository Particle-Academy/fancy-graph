import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useFullscreen, type FullscreenController, type FullscreenLabels, type FullscreenMode } from "@particle-academy/fancy-3d/fullscreen";
import type { GraphActivitySource } from "../types";
import type { ChangeMeta, GraphModel } from "./model";

/**
 * Full screen on a graph view. The mechanism is fancy-3d's one implementation
 * (`@particle-academy/fancy-3d/fullscreen`, React only, no WebGL); this is the
 * graph's side of it: the props, the controls contract, the handle, the state
 * and the activity. No react-fancy here, so every entry may use it.
 */
export interface GraphFullscreenProps {
  /** Controlled full screen. The view's root goes full screen: canvas, labels, controls overlay and `overlay`. */
  fullscreen?: boolean;
  defaultFullscreen?: boolean;
  /** Every requested change: the button or Esc (`"user"`), the handle (`"api"`, or the source passed). */
  onFullscreenChange?: (fullscreen: boolean, meta: ChangeMeta) => void;
  /** The toggle's accessible names. */
  fullscreenLabels?: Partial<FullscreenLabels>;
  /**
   * The view's own full-screen button. Default: shown when there is no
   * `controls` overlay (which carries one: `GraphViewControls` does, a custom
   * one gets `onFullscreenChange`). `true` shows it anyway, `false` hides it.
   */
  fullscreenButton?: boolean;
  /**
   * Things drawn over the view, inside its root: breadcrumbs, a fact card, a
   * search box. They go full screen with the view; anything a host renders
   * beside the view does not. The layer passes pointer events through to the
   * canvas except on its direct children.
   */
  overlay?: ReactNode;
}

/** What `GraphControlsProps` carries about full screen. */
export interface GraphControlsFullscreen {
  /** Whether the view is full screen. */
  fullscreen: boolean;
  /** False where nothing owns full screen (a `GraphSceneOnStage` on a bare stage): draw no button. */
  fullscreenAvailable: boolean;
  onFullscreenChange(fullscreen: boolean): void;
}

/** The full-screen part of a view's handle. */
export interface GraphFullscreenHandle {
  /** Enter or leave full screen through the controlled path. False where nothing owns full screen. */
  setFullscreen(fullscreen: boolean, opts?: { source?: GraphActivitySource }): boolean;
}

/** The full-screen part of `getState()`. */
export interface GraphFullscreenState {
  fullscreen: boolean;
  /** `"native"` (the Fullscreen API), `"expanded"` (the fixed full-viewport fallback), or null. */
  fullscreenMode: FullscreenMode | null;
}

export interface GraphFullscreen {
  controller: FullscreenController | null;
  /** Ask for a change, recording who asked (fancy-3d knows no "agent"). */
  set(on: boolean, source: GraphActivitySource): boolean;
  controls: GraphControlsFullscreen;
  state(): GraphFullscreenState;
}

const toGraphSource = (s: string): GraphActivitySource => (s === "api" ? "api" : "user");

/** The controller for a view that OWNS its root (GraphView, GraphView3D). */
export function useOwnFullscreen(root: RefObject<HTMLElement | null>, props: GraphFullscreenProps): { controller: FullscreenController; asked: RefObject<GraphActivitySource | null> } {
  const asked = useRef<GraphActivitySource | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const controller = useFullscreen(root, {
    fullscreen: props.fullscreen,
    defaultFullscreen: props.defaultFullscreen,
    labels: props.fullscreenLabels,
    onFullscreenChange: (on, meta) => {
      const source = asked.current ?? toGraphSource(meta.source);
      asked.current = source;
      latest.current.onFullscreenChange?.(on, { source });
    },
  });
  return { controller, asked };
}

/**
 * The graph's side of a controller (its own, or a host Stage's): the controls
 * props, the handle, the state, and a `"fullscreen"` activity on every actual
 * change (`id` `"on"` / `"off"`).
 */
export function useGraphFullscreen(controller: FullscreenController | null, model: GraphModel, asked?: RefObject<GraphActivitySource | null>): GraphFullscreen {
  const own = useRef<GraphActivitySource | null>(null);
  const sourceRef = asked ?? own;
  const ctl = useRef(controller);
  ctl.current = controller;
  const on = controller?.fullscreen ?? false;
  const seen = useRef(on);
  useEffect(() => {
    if (seen.current === on) return;
    seen.current = on;
    model.emit("fullscreen", on ? "on" : "off", sourceRef.current ?? "user");
    sourceRef.current = null;
  }, [on, model, sourceRef]);

  const set = (next: boolean, source: GraphActivitySource) => {
    const c = ctl.current;
    if (!c) return false;
    if (c.fullscreen !== next) sourceRef.current = source;
    c.setFullscreen(next, { source: source === "user" ? "user" : "api" });
    return true;
  };
  return {
    controller,
    set,
    controls: { fullscreen: on, fullscreenAvailable: controller !== null, onFullscreenChange: (next) => void set(next, "user") },
    state: () => ({ fullscreen: ctl.current?.fullscreen ?? false, fullscreenMode: ctl.current?.mode ?? null }),
  };
}

/** Whether the view draws its own button: by default only when no controls overlay carries one. */
export function showsOwnButton(props: GraphFullscreenProps & { controls?: unknown }): boolean {
  return props.fullscreenButton ?? !props.controls;
}

/** Pointer events pass through the overlay layer except on its children. */
export const OVERLAY_CSS = "[data-fancy-graph-overlay] > * { pointer-events: auto; }";
