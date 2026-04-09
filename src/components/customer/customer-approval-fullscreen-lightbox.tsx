"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Obrázek / PDF — u obrázků preferujte annotatedImageUrl (export z editoru). */
  url: string;
  isPdf: boolean;
  footer?: React.ReactNode;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

export function CustomerApprovalFullscreenLightbox({
  open,
  onClose,
  title,
  url,
  isPdf,
  footer,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [zoom, setZoom] = useState(1);
  const backdropRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const wheelHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setZoom(1);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  useEffect(() => {
    const el = wheelHostRef.current;
    if (!el || !open || isPdf) return;
    const fn = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.12 : 0.12;
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)));
    };
    el.addEventListener("wheel", fn, { passive: false });
    return () => el.removeEventListener("wheel", fn);
  }, [open, isPdf]);

  if (!mounted || !open) return null;

  const node = (
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal
      aria-label={title}
      className="fixed inset-0 z-[200] flex flex-col bg-black"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-2 py-2 sm:px-4">
        <p className="min-w-0 truncate text-sm font-medium text-white">{title}</p>
        <div className="flex shrink-0 items-center gap-1">
          {!isPdf ? (
            <>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-11 w-11 text-white hover:bg-white/10"
                aria-label="Oddálit"
                onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 0.25))}
              >
                <ZoomOut className="h-5 w-5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-11 w-11 text-white hover:bg-white/10"
                aria-label="Přiblížit"
                onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.25))}
              >
                <ZoomIn className="h-5 w-5" />
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-11 w-11 text-white hover:bg-white/10"
            aria-label="Zavřít"
            onClick={onClose}
          >
            <X className="h-6 w-6" />
          </Button>
        </div>
      </div>

      <div
        ref={wheelHostRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={contentRef}
          className="flex h-full min-h-0 w-full items-center justify-center p-0 sm:p-2"
          onClick={(e) => e.stopPropagation()}
        >
          {isPdf ? (
            <iframe
              title={title}
              src={url}
              className="h-full w-full border-0 bg-white"
            />
          ) : (
            <div
              className="flex h-full min-h-0 w-full items-center justify-center overflow-auto p-1"
              style={{ touchAction: "manipulation" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className={cn(
                  "max-h-full max-w-full object-contain transition-transform duration-150",
                  "select-none"
                )}
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "center center",
                }}
                draggable={false}
              />
            </div>
          )}
        </div>
      </div>

      {footer ? (
        <div className="max-h-[40vh] shrink-0 overflow-y-auto border-t border-white/10 bg-black/80 p-3 sm:p-4">
          {footer}
        </div>
      ) : null}

      <p className="sr-only">
        Ctrl a kolečko myši mění přiblížení. Klávesa Escape zavře náhled.
      </p>
    </div>
  );

  return createPortal(node, document.body);
}
