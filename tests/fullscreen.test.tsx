// @vitest-environment jsdom
/**
 * Full screen on every view (owner, 2026-11-28): the view's ROOT goes full
 * screen, so the controls overlay, labels, the host's overlay (breadcrumbs,
 * fact cards), selection and keyboard all keep working inside it. The
 * mechanism is fancy-3d's one implementation; these hold the graph's side:
 * the button, the controls contract, the handle, state, activity.
 */
import { act, createRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "@particle-academy/fancy-3d-three/three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FullscreenContext, useFullscreen } from "@particle-academy/fancy-3d/fullscreen";
import { GraphView, type GraphActivity, type GraphData, type GraphViewHandle } from "../src/index";
import { GraphViewControls } from "../src/controls";

// GraphView3D's Stage, recorded: the real Stage needs WebGL, and its own
// full-screen behaviour (deferring to an outer viewer) is fancy-3d-three's to test.
const stageProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));
vi.mock("@particle-academy/fancy-3d-three/react", async () => {
  const React = await import("react");
  const T = await import("@particle-academy/fancy-3d-three/three");
  const Ctx = React.createContext<unknown>(null);
  function Stage(props: Record<string, unknown> & { children?: ReactNode; overlay?: ReactNode }) {
    stageProps.last = props;
    const [stage] = React.useState(() => {
      const canvas = document.createElement("canvas");
      const overlayRoot = document.createElement("div");
      const camera = new T.PerspectiveCamera(50, 1, 0.1, 1000);
      const target = new T.Vector3();
      return {
        scene: new T.Scene(),
        camera,
        canvas,
        overlayRoot,
        renderer: { getPixelRatio: () => 1, setClearColor() {}, render() {} },
        onFrame: () => () => {},
        controls: { target, update: () => camera.lookAt(target), enabled: true, minDistance: 0, maxDistance: Infinity },
      };
    });
    const box = React.useRef<HTMLDivElement>(null);
    React.useLayoutEffect(() => {
      box.current!.append(stage.canvas, stage.overlayRoot);
    }, [stage]);
    return React.createElement(
      "div",
      { ref: box, "data-fancy-3d-stage": "" },
      React.createElement(Ctx.Provider, { value: stage }, props.children, props.overlay != null ? React.createElement("div", { "data-fancy-3d-stage-overlay": "" }, props.overlay) : null),
    );
  }
  return { Stage, useStage: () => React.useContext(Ctx) };
});

const { GraphView3D } = await import("../src/three/index");
type Handle3D = import("../src/three/index").GraphScene3DHandle;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* The Fullscreen API, mocked as a browser behaves. */
let fsElement: Element | null = null;
const proto = HTMLElement.prototype as HTMLElement & { requestFullscreen?: () => Promise<void> };
function installApi() {
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fsElement });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => true });
  proto.requestFullscreen = function (this: HTMLElement) {
    fsElement = this;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  };
  (document as { exitFullscreen?: () => Promise<void> }).exitFullscreen = () => {
    fsElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  };
}
function removeApi() {
  delete (proto as { requestFullscreen?: unknown }).requestFullscreen;
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => undefined });
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const observers: Array<() => void> = [];
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  fsElement = null;
  installApi();
  observers.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.style.overflow = "";
});

const data: GraphData = {
  nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }],
  links: [{ source: "a", target: "b" }],
};
const graphRoot = () => container.querySelector<HTMLElement>("[data-fancy-graph]")!;
const builtIn = () => container.querySelector<HTMLButtonElement>("[data-fancy-3d-fullscreen-button]");
const overlayButton = () => container.querySelector<HTMLButtonElement>('[data-fancy-graph-control="fullscreen"]');

describe("GraphView (2D) full screen", () => {
  it("shows a full-screen button by default; it full-screens the view root with labels and overlay", async () => {
    act(() => root.render(<GraphView data={data} overlay={<nav data-crumbs="">crumbs</nav>} style={{ height: 300 }} />));
    expect(graphRoot().contains(builtIn())).toBe(true);
    act(() => builtIn()!.click());
    await flush();
    expect(document.fullscreenElement).toBe(graphRoot());
    expect(graphRoot().contains(container.querySelector("[data-crumbs]"))).toBe(true);
    expect(graphRoot().contains(container.querySelector("[data-fancy-graph-labels]"))).toBe(true);
  });

  it("fullscreenButton={false} hides it", () => {
    act(() => root.render(<GraphView data={data} fullscreenButton={false} />));
    expect(builtIn()).toBe(null);
  });

  it("with GraphViewControls the overlay carries the button (one button, not two)", async () => {
    const onChange = vi.fn();
    act(() => root.render(<GraphView data={data} controls={GraphViewControls} onFullscreenChange={onChange} />));
    expect(builtIn()).toBe(null);
    const btn = overlayButton()!;
    expect(btn.getAttribute("data-fancy-graph-toggle")).toBe("fullscreen");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    act(() => btn.click());
    await flush();
    expect(onChange).toHaveBeenCalledWith(true, { source: "user" });
    expect(document.fullscreenElement).toBe(graphRoot());
    expect(overlayButton()!.getAttribute("aria-pressed")).toBe("true");
  });

  it("fullscreenButton forces the built-in one next to custom controls", () => {
    const Custom = () => null;
    act(() => root.render(<GraphView data={data} controls={Custom} fullscreenButton />));
    expect(builtIn()).not.toBe(null);
  });

  it("is controlled, and the handle reports state and broadcasts activity", async () => {
    const ref = createRef<GraphViewHandle>();
    const activity: GraphActivity[] = [];
    const onChange = vi.fn();
    act(() => root.render(<GraphView ref={ref} data={data} onFullscreenChange={onChange} onActivity={(a) => activity.push(a)} />));
    expect(ref.current!.getState().fullscreen).toBe(false);
    act(() => void ref.current!.setFullscreen(true, { source: "agent" }));
    await flush();
    expect(onChange).toHaveBeenCalledWith(true, { source: "agent" });
    expect(ref.current!.getState()).toMatchObject({ fullscreen: true, fullscreenMode: "native" });
    expect(activity.filter((a) => a.type === "fullscreen").map((a) => [a.id, a.source])).toEqual([["on", "agent"]]);
    act(() => root.render(<GraphView ref={ref} data={data} fullscreen={false} onFullscreenChange={onChange} />));
    await flush();
    expect(document.fullscreenElement).toBe(null);
  });

  it("selection works in full screen, and Esc leaves full screen without clearing it (expanded fallback)", async () => {
    removeApi();
    const ref = createRef<GraphViewHandle>();
    act(() => root.render(<GraphView ref={ref} data={data} />));
    act(() => builtIn()!.click());
    await flush();
    expect(graphRoot().style.position).toBe("fixed");
    act(() => ref.current!.select("b"));
    expect(graphRoot().dataset.fancyGraphSelected).toBe("b");
    const canvas = container.querySelector<HTMLCanvasElement>("[data-fancy-graph-canvas]")!;
    canvas.focus();
    act(() => {
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(ref.current!.getState().fullscreen).toBe(false);
    expect(graphRoot().style.position).toBe("relative");
    expect(graphRoot().dataset.fancyGraphSelected).toBe("b");
  });

  it("the canvas follows the root's new size", async () => {
    removeApi();
    act(() => root.render(<GraphView data={data} />));
    act(() => builtIn()!.click());
    await flush();
    Object.defineProperty(graphRoot(), "clientWidth", { configurable: true, get: () => 1600 });
    Object.defineProperty(graphRoot(), "clientHeight", { configurable: true, get: () => 900 });
    act(() => observers.forEach((cb) => cb()));
    const canvas = container.querySelector<HTMLCanvasElement>("[data-fancy-graph-canvas]")!;
    expect(canvas.width / (window.devicePixelRatio || 1)).toBe(1600);
    expect(canvas.height / (window.devicePixelRatio || 1)).toBe(900);
  });
});

describe("GraphView3D full screen", () => {
  it("the view root owns it; its Stage shows no second button and gets the overlay", async () => {
    const ref = createRef<Handle3D>();
    act(() => root.render(<GraphView3D ref={ref} data={data} overlay={<aside data-fact-card="">fact</aside>} />));
    expect(stageProps.last!.fullscreenButton).toBe(false);
    expect(graphRoot().contains(container.querySelector("[data-fact-card]"))).toBe(true);
    expect(container.querySelectorAll("[data-fancy-3d-fullscreen-button]")).toHaveLength(1);
    act(() => builtIn()!.click());
    await flush();
    expect(document.fullscreenElement).toBe(graphRoot());
    expect(ref.current!.getState().fullscreen).toBe(true);
  });

  it("GraphViewControls on the 3D view carries the button; the handle drives it", async () => {
    const ref = createRef<Handle3D>();
    const activity: GraphActivity[] = [];
    act(() => root.render(<GraphView3D ref={ref} data={data} controls={GraphViewControls} onActivity={(a) => activity.push(a)} />));
    expect(builtIn()).toBe(null);
    act(() => overlayButton()!.click());
    await flush();
    expect(document.fullscreenElement).toBe(graphRoot());
    act(() => void ref.current!.setFullscreen(false));
    await flush();
    expect(document.fullscreenElement).toBe(null);
    expect(activity.filter((a) => a.type === "fullscreen").map((a) => [a.id, a.source])).toEqual([
      ["on", "user"],
      ["off", "api"],
    ]);
  });

  it("GraphScene3D on a host's Stage uses the host's full-screen controller", async () => {
    const { GraphSceneOnStage } = await import("../src/three/index");
    const canvas = document.createElement("canvas");
    const overlayRoot = document.createElement("div");
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    const target = new THREE.Vector3();
    const stage = {
      scene: new THREE.Scene(),
      camera,
      canvas,
      overlayRoot,
      renderer: { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer,
      onFrame: () => () => {},
      controls: { target, update: () => camera.lookAt(target), enabled: true, minDistance: 0, maxDistance: Infinity },
    } as unknown as import("../src/three/index").StageLike;
    function Host() {
      const fs = useFullscreen(hostRef);
      return (
        <FullscreenContext.Provider value={fs}>
          <div ref={hostRef} data-host="">
            <GraphSceneOnStage stage={stage} data={data} controls={GraphViewControls} />
          </div>
        </FullscreenContext.Provider>
      );
    }
    const hostRef = { current: null as HTMLDivElement | null };
    act(() => root.render(<Host />));
    container.querySelector("[data-host]")!.append(canvas, overlayRoot);
    const btn = overlayRoot.querySelector<HTMLButtonElement>('[data-fancy-graph-control="fullscreen"]')!;
    act(() => btn.click());
    await flush();
    expect(document.fullscreenElement).toBe(container.querySelector("[data-host]"));
  });

  it("with no controller anywhere, the overlay shows no full-screen button", async () => {
    const { GraphSceneOnStage } = await import("../src/three/index");
    const canvas = document.createElement("canvas");
    const overlayRoot = document.createElement("div");
    container.append(canvas, overlayRoot);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    const target = new THREE.Vector3();
    const stage = {
      scene: new THREE.Scene(),
      camera,
      canvas,
      overlayRoot,
      renderer: { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer,
      onFrame: () => () => {},
      controls: { target, update: () => camera.lookAt(target), enabled: true, minDistance: 0, maxDistance: Infinity },
    } as unknown as import("../src/three/index").StageLike;
    const ref = createRef<Handle3D>();
    act(() => root.render(<GraphSceneOnStage ref={ref} stage={stage} data={data} controls={GraphViewControls} />));
    expect(overlayRoot.querySelector('[data-fancy-graph-control="fullscreen"]')).toBe(null);
    expect(ref.current!.setFullscreen(true)).toBe(false);
  });
});
