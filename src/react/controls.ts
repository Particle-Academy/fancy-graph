import { createElement, type ComponentType, type ReactElement } from "react";
import type { GraphLayerState, GraphLayerVisibility, LinkVisibility } from "../layers";
import type { GraphActivitySource } from "../types";
import type { GraphModel } from "./model";

/**
 * What a view-controls component gets from `<GraphView controls={...}>` /
 * `<GraphView3D controls={...}>`: the view's state as JSON, and callbacks that
 * go through the same controlled paths a click takes (source `"user"`).
 * `GraphViewControls` in `@particle-academy/fancy-graph/controls` is one;
 * write your own to the same shape.
 */
export interface GraphControlsProps {
  selected: string | null;
  /** The selected node's label (as text), or null. */
  selectedLabel: string | null;
  onClearSelection(): void;
  /** The view's declared layers, in order. */
  layers: GraphLayerState[];
  onLayerChange(id: string, visible: boolean): void;
  linkVisibility: LinkVisibility;
  onLinkVisibilityChange(mode: LinkVisibility): void;
  /** True when the layout moves every frame (the cosmos's orbits): a pause control makes sense. */
  animated: boolean;
  paused: boolean;
  onPausedChange(paused: boolean): void;
}

/** The handle methods every view shares for these controls. */
export interface GraphControlsHandle {
  /** Clears the selection through the controlled path. */
  clearSelection(opts?: { source?: GraphActivitySource }): void;
  /** The declared layers and whether each is drawn. */
  getLayers(): GraphLayerState[];
  /** Switches one layer through `onLayersChange`. False for an id the view does not declare. */
  setLayer(id: string, visible: boolean, opts?: { source?: GraphActivitySource }): boolean;
  setLinkVisibility(mode: LinkVisibility, opts?: { source?: GraphActivitySource }): void;
  /** Pauses or resumes an animated layout through `onPausedChange`. */
  setPaused(paused: boolean, opts?: { source?: GraphActivitySource }): void;
}

/** The view state these controls add to `getState()`. */
export interface GraphControlsState {
  layers: GraphLayerVisibility;
  linkVisibility: LinkVisibility;
  paused: boolean;
  animated: boolean;
}

export function controlsHandle(m: () => GraphModel): GraphControlsHandle {
  return {
    clearSelection: (opts) => m().select(null, { source: opts?.source ?? "api" }),
    getLayers: () => m().layerStates.map((l) => ({ ...l })),
    setLayer: (id, visible, opts) => m().setLayer(id, visible, { source: opts?.source ?? "api" }),
    setLinkVisibility: (mode, opts) => m().setLinkVisibility(mode, { source: opts?.source ?? "api" }),
    setPaused: (paused, opts) => m().setPaused(paused, { source: opts?.source ?? "api" }),
  };
}

export function controlsState(m: GraphModel, animated: boolean): GraphControlsState {
  return { layers: { ...m.layers }, linkVisibility: m.linkVisibility, paused: m.paused, animated };
}

/** Stable handles for the root element: visible layer ids, the link mode, paused. */
export function controlsDataset(m: GraphModel): Record<string, string> {
  return {
    "data-fancy-graph-layers": m.layerStates.filter((l) => l.visible).map((l) => l.id).join(" "),
    "data-fancy-graph-link-visibility": m.linkVisibility,
    "data-fancy-graph-paused": String(m.paused),
  };
}

/** Renders the host's controls component, wrapped so only the controls themselves take pointer events. */
export function renderControls(Controls: ComponentType<GraphControlsProps> | null | false | undefined, m: GraphModel, animated: boolean): ReactElement | null {
  if (!Controls) return null;
  const props: GraphControlsProps = {
    selected: m.selectedId,
    selectedLabel: m.selectedIndex >= 0 ? m.labelOf(m.selectedIndex) : null,
    onClearSelection: () => m.select(null, { source: "user" }),
    layers: m.layerStates,
    onLayerChange: (id, visible) => m.setLayer(id, visible, { source: "user" }),
    linkVisibility: m.linkVisibility,
    onLinkVisibilityChange: (mode) => m.setLinkVisibility(mode, { source: "user" }),
    animated,
    paused: m.paused,
    onPausedChange: (paused) => m.setPaused(paused, { source: "user" }),
  };
  return createElement(
    "div",
    { "data-fancy-graph-controls-root": "", style: { position: "absolute", inset: 0, pointerEvents: "none" } },
    createElement(Controls, props),
  );
}

/** True for a layout that moves every frame. */
export function isAnimatedLayout(layout: unknown): boolean {
  return typeof layout === "object" && layout !== null && !!(layout as { animated?: boolean }).animated;
}
