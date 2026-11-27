import { useId, useState, type CSSProperties } from "react";
import { Button } from "@particle-academy/react-fancy/button";
import { Card } from "@particle-academy/react-fancy/card";
import { MultiSwitch } from "@particle-academy/react-fancy/multi-switch";
import { Switch } from "@particle-academy/react-fancy/switch";
import type { GraphControlsProps } from "../react/controls";

/** Every visible string, English by default. */
export interface GraphViewControlsLabels {
  /** The button that opens the layer panel. */
  panel: string;
  clearSelection: string;
  /** Accessible name of the clear button; `{label}` is the selected node's label. */
  clearSelectionNamed: string;
  /** The link-mode choice: all links, or only the selection's. */
  linkMode: string;
  linksAll: string;
  linksFocus: string;
  /** The animation switch (the cosmos's orbits). */
  motion: string;
}

export const DEFAULT_CONTROLS_LABELS: GraphViewControlsLabels = {
  panel: "View",
  clearSelection: "Clear selection",
  clearSelectionNamed: "Clear selection: {label}",
  linkMode: "Links shown",
  linksAll: "All",
  linksFocus: "Selection",
  motion: "Motion",
};

export interface GraphViewControlsProps extends GraphControlsProps {
  /** Corner of the view. Default `"top-right"`. */
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  /** Whether the layer panel starts open. Default false: only its button shows. */
  defaultOpen?: boolean;
  labels?: Partial<GraphViewControlsLabels>;
  className?: string;
  style?: CSSProperties;
}

const CORNER: Record<NonNullable<GraphViewControlsProps["position"]>, CSSProperties> = {
  "top-right": { top: 12, right: 12, alignItems: "flex-end" },
  "top-left": { top: 12, left: 12, alignItems: "flex-start" },
  "bottom-right": { bottom: 12, right: 12, alignItems: "flex-end" },
  "bottom-left": { bottom: 12, left: 12, alignItems: "flex-start" },
};

/**
 * The view-controls overlay: clear the selection, and switch each layer the
 * view's preset draws (orbit paths, links and which of them, labels,
 * clusters, the sky) plus motion for an animated layout. Built from
 * react-fancy. Pass it as `controls={GraphViewControls}`; the view supplies
 * every prop. Every control carries `data-fancy-graph-control` (and layers
 * `data-fancy-graph-layer`).
 */
export function GraphViewControls(props: GraphViewControlsProps) {
  const { position = "top-right", defaultOpen = false, className, style } = props;
  const t = { ...DEFAULT_CONTROLS_LABELS, ...(props.labels ?? {}) };
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const links = props.layers.find((l) => l.id === "links");
  const linksOn = !!links?.visible && props.linkVisibility !== "none";
  return (
    <div
      data-fancy-graph-controls=""
      className={className}
      style={{ position: "absolute", display: "flex", flexDirection: "column", gap: 8, pointerEvents: "auto", maxWidth: "calc(100% - 24px)", ...CORNER[position], ...style }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        {props.selected !== null && (
          <Button
            size="sm"
            icon="x"
            data-fancy-graph-control="clear-selection"
            aria-label={t.clearSelectionNamed.replace("{label}", props.selectedLabel ?? props.selected)}
            onClick={props.onClearSelection}
          >
            {t.clearSelection}
          </Button>
        )}
        <Button size="sm" icon="layers" data-fancy-graph-control="panel" aria-expanded={open} aria-controls={panelId} active={open} onClick={() => setOpen(!open)}>
          {t.panel}
        </Button>
      </div>
      {open && (
        <Card id={panelId} size="sm" data-fancy-graph-controls-panel="">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {props.layers.map((layer) => (
              <Switch
                key={layer.id}
                size="sm"
                label={layer.label}
                checked={layer.id === "links" ? linksOn : layer.visible}
                onCheckedChange={(on) => {
                  props.onLayerChange(layer.id, on);
                  // Links switched on while the mode says "none" would still draw nothing.
                  if (layer.id === "links" && on && props.linkVisibility === "none") props.onLinkVisibilityChange("all");
                }}
                data-fancy-graph-control="layer"
                data-fancy-graph-layer={layer.id}
              />
            ))}
            {linksOn && (
              <MultiSwitch
                size="sm"
                label={t.linkMode}
                list={[
                  { value: "all", label: t.linksAll },
                  { value: "focus", label: t.linksFocus },
                ]}
                value={props.linkVisibility}
                onValueChange={(mode) => props.onLinkVisibilityChange(mode as "all" | "focus")}
                data-fancy-graph-control="link-visibility"
              />
            )}
            {props.animated && (
              <Switch size="sm" label={t.motion} checked={!props.paused} onCheckedChange={(on) => props.onPausedChange(!on)} data-fancy-graph-control="motion" />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
