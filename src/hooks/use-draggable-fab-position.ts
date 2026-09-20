"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const AI_FAB_POSITION_STORAGE_KEY = "rajmondata_ai_fab_position";

export type FabPosition = { left: number; top: number };

const MARGIN = 12;
const FAB_SIZE = 56;

function readStoredPosition(): FabPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AI_FAB_POSITION_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as FabPosition;
    if (typeof p.left === "number" && typeof p.top === "number") return p;
  } catch {
    /* ignore */
  }
  return null;
}

function defaultPosition(): FabPosition {
  if (typeof window === "undefined") return { left: 16, top: 400 };
  const navH = Number(
    getComputedStyle(document.documentElement).getPropertyValue("--mobile-bottom-nav-height") || 72
  );
  const safeBottom = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("env(safe-area-inset-bottom)") || "0"
  );
  return {
    left: window.innerWidth - FAB_SIZE - MARGIN,
    top: window.innerHeight - FAB_SIZE - MARGIN - navH - safeBottom - 16,
  };
}

function clampPosition(pos: FabPosition): FabPosition {
  if (typeof window === "undefined") return pos;
  const vv = window.visualViewport;
  const vw = vv?.width ?? window.innerWidth;
  const vh = vv?.height ?? window.innerHeight;
  const offsetTop = vv?.offsetTop ?? 0;
  const maxLeft = vw - FAB_SIZE - MARGIN;
  const maxTop = offsetTop + vh - FAB_SIZE - MARGIN;
  return {
    left: Math.min(Math.max(MARGIN, pos.left), maxLeft),
    top: Math.min(Math.max(offsetTop + MARGIN, pos.top), maxTop),
  };
}

function snapToEdge(pos: FabPosition): FabPosition {
  if (typeof window === "undefined") return pos;
  const vw = window.visualViewport?.width ?? window.innerWidth;
  const centerX = pos.left + FAB_SIZE / 2;
  const snapLeft = MARGIN;
  const snapRight = vw - FAB_SIZE - MARGIN;
  const left = centerX < vw / 2 ? snapLeft : snapRight;
  return { ...pos, left };
}

type Options = {
  enabled: boolean;
  /** Spodní hrana oblasti, kterou FAB nesmí překrývat (px od spodu viewportu). */
  avoidBottomInset?: number;
};

export function useDraggableFabPosition({ enabled, avoidBottomInset = 0 }: Options) {
  const [pos, setPos] = useState<FabPosition>(() => clampPosition(readStoredPosition() ?? defaultPosition()));
  const draggingRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const movedRef = useRef(false);

  const persist = useCallback((p: FabPosition) => {
    try {
      localStorage.setItem(AI_FAB_POSITION_STORAGE_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  }, []);

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
      const fabBottom = prev.top + FAB_SIZE;
      const inputTop = rect.top;
      if (fabBottom <= inputTop - 8) return prev;
      const next = clampPosition({ left: prev.left, top: inputTop - FAB_SIZE - 12 });
      persist(next);
      return next;
    });
  }, [enabled, persist]);

  useEffect(() => {
    if (!enabled) return;
    const stored = readStoredPosition();
    setPos(clampPosition(stored ?? defaultPosition()));
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onResize = () => setPos((p) => clampPosition(p));
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("scroll", applyKeyboardAvoidance);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("scroll", applyKeyboardAvoidance);
    };
  }, [enabled, applyKeyboardAvoidance]);

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener("focusin", applyKeyboardAvoidance);
    return () => document.removeEventListener("focusin", applyKeyboardAvoidance);
  }, [enabled, applyKeyboardAvoidance]);

  useEffect(() => {
    if (!enabled || avoidBottomInset <= 0) return;
    setPos((prev) => {
      const vv = window.visualViewport;
      const vh = vv?.height ?? window.innerHeight;
      const offsetTop = vv?.offsetTop ?? 0;
      const maxTop = offsetTop + vh - FAB_SIZE - MARGIN - avoidBottomInset;
      if (prev.top <= maxTop) return prev;
      return clampPosition({ ...prev, top: maxTop });
    });
  }, [enabled, avoidBottomInset]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return;
      draggingRef.current = true;
      movedRef.current = false;
      pointerIdRef.current = e.pointerId;
      dragStartRef.current = { x: e.clientX, y: e.clientY, left: pos.left, top: pos.top };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [enabled, pos.left, pos.top]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current || !dragStartRef.current || e.pointerId !== pointerIdRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) movedRef.current = true;
      const next = clampPosition({
        left: dragStartRef.current.left + dx,
        top: dragStartRef.current.top + dy,
      });
      setPos(next);
    },
    []
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerId !== pointerIdRef.current) return;
      draggingRef.current = false;
      pointerIdRef.current = null;
      dragStartRef.current = null;
      setPos((p) => {
        const snapped = snapToEdge(p);
        persist(snapped);
        return snapped;
      });
    },
    [persist]
  );

  return {
    pos,
    fabSize: FAB_SIZE,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    wasDragged: () => movedRef.current,
    resetDragFlag: () => {
      movedRef.current = false;
    },
  };
}
