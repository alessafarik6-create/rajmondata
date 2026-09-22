/** Detekce skutečného přehrávání v DOM kontejneru EZUIKit (bez závislosti na telemetry). */

export type HikPlayerDomLayer = {
  tag: "video" | "canvas" | "iframe";
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
  display: string;
  visibility: string;
  opacity: string;
  zIndex: string;
  hasContent: boolean;
};

export type HikPlayerDomInspect = {
  hasVideo: boolean;
  hasCanvas: boolean;
  videoWidth: number;
  videoHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  canvasClientWidth: number;
  canvasClientHeight: number;
  videoVisible: boolean;
  firstFrameLikely: boolean;
  renderedFrameLikely: boolean;
  layers: HikPlayerDomLayer[];
};

export type HikPlayerDomInspectOptions = {
  /** @deprecated Nepoužívat pro potvrzení PLAYING — může falešně detekovat prázdný canvas. */
  allowClientSizeCanvas?: boolean;
};

function elementVisible(el: HTMLElement): boolean {
  const st = window.getComputedStyle(el);
  if (st.display === "none" || st.visibility === "hidden") return false;
  if (Number(st.opacity) === 0) return false;
  return true;
}

/** Vzorek pixelů — funguje pro 2D canvas; WebGL/WASM často vrátí false bez readPixels. */
export function hikCanvasHasNonBlackPixels(canvas: HTMLCanvasElement): boolean {
  try {
    const w = Math.min(canvas.width || canvas.clientWidth, 48);
    const h = Math.min(canvas.height || canvas.clientHeight, 48);
    if (w < 2 || h < 2) return false;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 10 || data[i + 1] > 10 || data[i + 2] > 10) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function hikWebGlCanvasHasContent(canvas: HTMLCanvasElement): boolean {
  try {
    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return false;
    const pixels = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels[0] > 12 || pixels[1] > 12 || pixels[2] > 12;
  } catch {
    return false;
  }
}

function canvasHasRenderedContent(canvas: HTMLCanvasElement): boolean {
  return hikCanvasHasNonBlackPixels(canvas) || hikWebGlCanvasHasContent(canvas);
}

export function hikContainerHasRenderedFrame(container: HTMLElement | null): boolean {
  if (!container) return false;
  const video = container.querySelector("video") as HTMLVideoElement | null;
  if (video && video.videoWidth > 0 && video.videoHeight > 0 && elementVisible(video)) {
    return true;
  }
  const canvases = container.querySelectorAll("canvas");
  for (const node of canvases) {
    const canvas = node as HTMLCanvasElement;
    if (!elementVisible(canvas)) continue;
    if (canvasHasRenderedContent(canvas)) return true;
  }
  return false;
}

function layerFromElement(
  el: HTMLVideoElement | HTMLCanvasElement | HTMLIFrameElement,
  tag: HikPlayerDomLayer["tag"]
): HikPlayerDomLayer {
  const st = window.getComputedStyle(el);
  let hasContent = false;
  if (tag === "video") {
    const v = el as HTMLVideoElement;
    hasContent = v.videoWidth > 0 && v.videoHeight > 0;
  } else if (tag === "canvas") {
    hasContent = canvasHasRenderedContent(el as HTMLCanvasElement);
  }
  return {
    tag,
    width: tag === "video" ? (el as HTMLVideoElement).videoWidth : (el as HTMLCanvasElement).width,
    height:
      tag === "video" ? (el as HTMLVideoElement).videoHeight : (el as HTMLCanvasElement).height,
    clientWidth: el.clientWidth,
    clientHeight: el.clientHeight,
    display: st.display,
    visibility: st.visibility,
    opacity: st.opacity,
    zIndex: st.zIndex,
    hasContent,
  };
}

export function inspectHikPlayerDom(
  container: HTMLElement | null,
  opts?: HikPlayerDomInspectOptions
): HikPlayerDomInspect {
  const empty: HikPlayerDomInspect = {
    hasVideo: false,
    hasCanvas: false,
    videoWidth: 0,
    videoHeight: 0,
    canvasWidth: 0,
    canvasHeight: 0,
    canvasClientWidth: 0,
    canvasClientHeight: 0,
    videoVisible: false,
    firstFrameLikely: false,
    renderedFrameLikely: false,
    layers: [],
  };
  if (!container) return empty;

  const layers: HikPlayerDomLayer[] = [];
  container.querySelectorAll("video").forEach((node) => {
    layers.push(layerFromElement(node as HTMLVideoElement, "video"));
  });
  container.querySelectorAll("canvas").forEach((node) => {
    layers.push(layerFromElement(node as HTMLCanvasElement, "canvas"));
  });
  container.querySelectorAll("iframe").forEach((node) => {
    layers.push(layerFromElement(node as HTMLIFrameElement, "iframe"));
  });

  const video = container.querySelector("video") as HTMLVideoElement | null;
  const canvas = container.querySelector("canvas") as HTMLCanvasElement | null;
  const videoWidth = video?.videoWidth ?? 0;
  const videoHeight = video?.videoHeight ?? 0;
  const canvasWidth = canvas?.width ?? 0;
  const canvasHeight = canvas?.height ?? 0;
  const canvasClientWidth = canvas?.clientWidth ?? 0;
  const canvasClientHeight = canvas?.clientHeight ?? 0;
  const videoVisible = video ? elementVisible(video) : false;
  const renderedFrameLikely = hikContainerHasRenderedFrame(container);
  const videoReady =
    Boolean(video) &&
    videoVisible &&
    videoWidth > 0 &&
    videoHeight > 0;
  const canvasClientReady =
    Boolean(opts?.allowClientSizeCanvas && canvas) &&
    elementVisible(canvas as HTMLCanvasElement) &&
    canvasClientWidth >= 48 &&
    canvasClientHeight >= 48;

  return {
    hasVideo: Boolean(video),
    hasCanvas: Boolean(canvas),
    videoWidth,
    videoHeight,
    canvasWidth,
    canvasHeight,
    canvasClientWidth,
    canvasClientHeight,
    videoVisible,
    renderedFrameLikely,
    firstFrameLikely: videoReady || renderedFrameLikely || canvasClientReady,
    layers,
  };
}

export function hikPlayerContainerHasVideo(container: HTMLElement | null): boolean {
  return hikContainerHasRenderedFrame(container);
}

export function waitForNonZeroContainerSize(
  el: HTMLElement,
  maxWaitMs = 8000
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        resolve({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
        return;
      }
      if (Date.now() - start >= maxWaitMs) {
        resolve(null);
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

/** Přizpůsobí EZUIKit player skutečné velikosti wrapperu (bez přepisování interních canvas vrstev). */
export function resizePlayerToContainer(
  container: HTMLElement | null,
  player: unknown | null
): void {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  if (width <= 0 || height <= 0) return;

  const p = player as Record<string, unknown> | null;
  if (p) {
    for (const method of ["resize", "reSize", "changeSize", "setSize", "updateSize"]) {
      const fn = p[method];
      if (typeof fn !== "function") continue;
      try {
        (fn as (w: number, h: number) => void).call(player, width, height);
      } catch {
        try {
          (fn as (opts: { width: number; height: number }) => void).call(player, {
            width,
            height,
          });
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/** @deprecated use resizePlayerToContainer */
export function applyHikPlayerContainStyles(container: HTMLElement | null): void {
  resizePlayerToContainer(container, null);
}

export function watchHikPlayerFirstFrame(
  container: HTMLElement,
  onFrame: () => void,
  maxWaitMs = 30_000
): () => void {
  const deadline = Date.now() + maxWaitMs;
  let raf = 0;
  const tick = () => {
    if (Date.now() > deadline) return;
    if (hikContainerHasRenderedFrame(container)) {
      onFrame();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    if (raf) cancelAnimationFrame(raf);
  };
}

export function isLikelyHikStreamFatalError(info: unknown): boolean {
  if (info == null) return false;
  const text =
    typeof info === "string"
      ? info
      : typeof info === "object"
        ? JSON.stringify(info)
        : String(info);
  const lower = text.toLowerCase();
  if (lower.includes("eulog") || lower.includes("ezvizlife.com/stat")) return false;
  if (lower.includes("telemetry") || lower.includes("analytics")) return false;
  return (
    lower.includes("token") ||
    lower.includes("auth") ||
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("expired") ||
    lower.includes("offline") ||
    lower.includes("ezopen")
  );
}
