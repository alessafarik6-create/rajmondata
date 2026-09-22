/** Detekce skutečného přehrávání v DOM kontejneru EZUIKit (bez závislosti na telemetry). */

export function hikPlayerContainerHasVideo(container: HTMLElement | null): boolean {
  if (!container) return false;
  const video = container.querySelector("video");
  if (video) {
    if (video.readyState >= 2 && video.videoWidth > 0) return true;
    if (!video.paused && video.currentTime > 0) return true;
  }
  const canvas = container.querySelector("canvas");
  if (canvas && canvas.width > 0 && canvas.height > 0) return true;
  return false;
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

/** Přizpůsobí EZUIKit player + video/canvas skutečné velikosti wrapperu. */
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

  container.querySelectorAll("div").forEach((node) => {
    const el = node as HTMLElement;
    if (el === container) return;
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.maxWidth = "100%";
    el.style.maxHeight = "100%";
  });

  container.querySelectorAll("video, canvas").forEach((node) => {
    const el = node as HTMLElement;
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.maxWidth = "100%";
    el.style.maxHeight = "100%";
    el.style.objectFit = "contain";
  });
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
    if (hikPlayerContainerHasVideo(container)) {
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
