"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** @deprecated Pouze pro migraci — neukládat nové hodnoty. */
export const AI_FAB_POSITION_STORAGE_KEY = "rajmondata_ai_fab_position";

export const AI_ASSISTANT_POSITION_STORAGE_KEY = "rajmondata-ai-assistant-position-v2";

export type FabPosition = { left: number; top: number };

type StoredFabV2 = {
  v: 2;
  desktop?: FabPosition | null;
  mobile?: FabPosition | null;
};

const MARGIN = 12;
const DESKTOP_FAB = 60;
const MOBILE_FAB = 56;
const DESKTOP_RIGHT = 24;
const DESKTOP_BOTTOM = 24;
const MOBILE_RIGHT = 16;
const MOBILE_BOTTOM = 20;

function fabSizeFor(isMobile: boolean): number {
  return isMobile ? MOBILE_FAB : DESKTOP_FAB;
}

function readSafeAreaBottomPx(): number {
  if (typeof window === "undefined") return 0;
  const probe = document.getElementById("rajmondata-safe-area-probe");
  if (probe) return probe.getBoundingClientRect().height;
  return 0;
}

function mobileBottomNavPx(): number {
  if (typeof window === "undefined") return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--mobile-bottom-nav-height");
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function viewportMetrics() {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  return {
    vw: vv?.width ?? (typeof window !== "undefined" ? window.innerWidth : 360),
    vh: vv?.height ?? (typeof window !== "undefined" ? window.innerHeight : 640),
    offsetTop: vv?.offsetTop ?? 0,
  };
}

function defaultPosition(isMobile: boolean, avoidBottomInset: number): FabPosition {
  const { vw, vh, offsetTop } = viewportMetrics();
  const size = fabSizeFor(isMobile);
  const safeBottom = readSafeAreaBottomPx();
  const right = isMobile ? MOBILE_RIGHT : DESKTOP_RIGHT;
  const bottomBase = isMobile ? MOBILE_BOTTOM : DESKTOP_BOTTOM;
  const bottom =
    bottomBase +
    safeBottom +
    avoidBottomInset +
    (isMobile ? mobileBottomNavPx() : 0);

  return {
    left: vw - size - right,
    top: offsetTop + vh - size - bottom,
  };
}

function clampPosition(pos: FabPosition, isMobile: boolean, avoidBottomInset: number): FabPosition {
  const { vw, vh, offsetTop } = viewportMetrics();
  const size = fabSizeFor(isMobile);
  const safeBottom = readSafeAreaBottomPx();
  const minBottomGap =
    (isMobile ? MOBILE_BOTTOM : DESKTOP_BOTTOM) +
    safeBottom +
    avoidBottomInset +
    (isMobile ? mobileBottomNavPx() : 0);

  const maxLeft = vw - size - MARGIN;
  const minTop = offsetTop + MARGIN;
  const maxTop = offsetTop + vh - size - minBottomGap;

  return {
    left: Math.min(Math.max(MARGIN, pos.left), maxLeft),
    top: Math.min(Math.max(minTop, pos.top), maxTop),
  };
}

/** Staré / poškozené souřadnice (typicky vpravo nahoře) nebereme. */
function isPlausibleUserPosition(pos: FabPosition, isMobile: boolean): boolean {
  const { vh, offsetTop } = viewportMetrics();
  const size = fabSizeFor(isMobile);
  const minTopForBottomHalf = offsetTop + vh * 0.45;
  if (pos.top < minTopForBottomHalf) return false;
  if (pos.top > offsetTop + vh - size + 4) return false;
  if (pos.left < 0 || pos.left > viewportMetrics().vw) return false;
  return true;
}

function readStoredV2(isMobile: boolean): FabPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AI_ASSISTANT_POSITION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredFabV2;
      if (parsed?.v === 2) {
        const bucket = isMobile ? parsed.mobile : parsed.desktop;
        if (bucket && typeof bucket.left === "number" && typeof bucket.top === "number") {
          return bucket;
        }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const legacyRaw = localStorage.getItem(AI_FAB_POSITION_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as FabPosition;
      if (
        legacy &&
        typeof legacy.left === "number" &&
        typeof legacy.top === "number" &&
        isPlausibleUserPosition(legacy, isMobile)
      ) {
        return legacy;
      }
    }
  } catch {
    /* ignore */
  }

  return null;
}

function persistV2(isMobile: boolean, pos: FabPosition) {
  if (typeof window === "undefined") return;
  try {
    let existing: StoredFabV2 = { v: 2 };
    const raw = localStorage.getItem(AI_ASSISTANT_POSITION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredFabV2;
      if (parsed?.v === 2) existing = parsed;
    }
    if (isMobile) existing.mobile = pos;
    else existing.desktop = pos;
    localStorage.setItem(AI_ASSISTANT_POSITION_STORAGE_KEY, JSON.stringify(existing));
    localStorage.removeItem(AI_FAB_POSITION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function snapToEdge(pos: FabPosition, isMobile: boolean): FabPosition {
  const { vw } = viewportMetrics();
  const size = fabSizeFor(isMobile);
  const centerX = pos.left + size / 2;
  const snapLeft = MARGIN;
  const snapRight = vw - size - MARGIN;
  const left = centerX < vw / 2 ? snapLeft : snapRight;
  return { ...pos, left };
}

type Options = {
  enabled: boolean;
  isMobile: boolean;
  /** Spodní hrana oblasti, kterou FAB nesmí překrývat (px od spodu viewportu). */
  avoidBottomInset?: number;
};

export function useDraggableFabPosition({ enabled, isMobile, avoidBottomInset = 0 }: Options) {
  const size = fabSizeFor(isMobile);
  const [ready, setReady] = useState(false);
  const [pos, setPos] = useState<FabPosition>(() => ({ left: 0, top: 0 }));
  const draggingRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const movedRef = useRef(false);

  const resolvePosition = useCallback(() => {
    const stored = readStoredV2(isMobile);
    const next = clampPosition(stored ?? defaultPosition(isMobile, avoidBottomInset), isMobile, avoidBottomInset);
    setPos(next);
    setReady(true);
  }, [isMobile, avoidBottomInset]);

  useEffect(() => {
    if (!enabled) return;
    resolvePosition();
  }, [enabled, resolvePosition]);

  const persist = useCallback(
    (p: FabPosition) => {
      persistV2(isMobile, p);
    },
    [isMobile]
  );

  const applyKeyboardAvoidance = useCallback(() => {
    if (!enabled || typeof window === "undefined") return;
    const el = document.activeElement;
    const isTextInput =
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable);
    if (!isTextInput) return;

    const rect = el.getBoundingClientRect();
    setPos((prev) => {
      const fabBottom = prev.top + size;
      const inputTop = rect.top;
      if (fabBottom <= inputTop - 8) return prev;
      const next = clampPosition({ left: prev.left, top: inputTop - size - 12 }, isMobile, avoidBottomInset);
      persist(next);
      return next;
    });
  }, [enabled, persist, size, isMobile, avoidBottomInset]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onResize = () => setPos((p) => clampPosition(p, isMobile, avoidBottomInset));
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("scroll", applyKeyboardAvoidance);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("scroll", applyKeyboardAvoidance);
    };
  }, [enabled, applyKeyboardAvoidance, isMobile, avoidBottomInset]);

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener("focusin", applyKeyboardAvoidance);
    return () => document.removeEventListener("focusin", applyKeyboardAvoidance);
  }, [enabled, applyKeyboardAvoidance]);

  useEffect(() => {
    if (!enabled || avoidBottomInset <= 0) return;
    setPos((prev) => clampPosition(prev, isMobile, avoidBottomInset));
  }, [enabled, avoidBottomInset, isMobile]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return;
      e.preventDefault();
      draggingRef.current = true;
      movedRef.current = false;
      pointerIdRef.current = e.pointerId;
      dragStartRef.current = { x: e.clientX, y: e.clientY, left: pos.left, top: pos.top };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [enabled, pos.left, pos.top]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current || !dragStartRef.current || e.pointerId !== pointerIdRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) movedRef.current = true;
      const next = clampPosition(
        {
          left: dragStartRef.current.left + dx,
          top: dragStartRef.current.top + dy,
        },
        isMobile,
        avoidBottomInset
      );
      setPos(next);
    },
    [isMobile, avoidBottomInset]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerId !== pointerIdRef.current) return;
      draggingRef.current = false;
      pointerIdRef.current = null;
      dragStartRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      setPos((p) => {
        const snapped = snapToEdge(clampPosition(p, isMobile, avoidBottomInset), isMobile);
        persist(snapped);
        return snapped;
      });
    },
    [persist, isMobile, avoidBottomInset]
  );

  return {
    ready,
    pos,
    fabSize: size,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    wasDragged: () => movedRef.current,
    resetDragFlag: () => {
      movedRef.current = false;
    },
  };
}
