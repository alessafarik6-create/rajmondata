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
  maxWaitMs = 5000
): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= maxWaitMs) {
        resolve(false);
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

/** Vynutí contain na video/canvas uvnitř EZUIKit DOM (mobil / orientace). */
export function applyHikPlayerContainStyles(container: HTMLElement | null): void {
  if (!container) return;
  container.querySelectorAll("video, canvas").forEach((el) => {
    const node = el as HTMLElement;
    node.style.objectFit = "contain";
    node.style.maxWidth = "100%";
    node.style.maxHeight = "100%";
    node.style.width = "auto";
    node.style.height = "auto";
    node.style.margin = "auto";
  });
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

/** Chyby, které opravdu vyžadují nový stream token — ne telemetry 404. */
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
