"use client";

import { useMemo, useState } from "react";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveInventoryItemImageUrl } from "@/lib/inventory-item-image";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  item: Record<string, unknown> | null | undefined;
  /** Velikost strany čtverce v px (výchozí 48). */
  size?: number;
  className?: string;
  /** Otevře fullscreen náhled po kliku. */
  enableLightbox?: boolean;
  /** Titulek v lightboxu (volitelné). */
  lightboxTitle?: string;
};

export function InventoryItemThumbnail({
  item,
  size = 48,
  className,
  enableLightbox = false,
  lightboxTitle,
}: Props) {
  const url = resolveInventoryItemImageUrl(item);
  const [broken, setBroken] = useState(false);
  const iconSize = Math.max(14, Math.round(size * 0.42));
  const [open, setOpen] = useState(false);
  const title = useMemo(() => {
    if (typeof lightboxTitle === "string" && lightboxTitle.trim()) {
      return lightboxTitle.trim().slice(0, 200);
    }
    const nm = item?.name != null ? String((item as any).name).trim() : "";
    return nm || "Náhled skladové položky";
  }, [lightboxTitle, item]);

  const canShowImage = Boolean(url && !broken);

  return (
    <>
      <button
        type="button"
        className={cn(
          "shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center",
          enableLightbox && canShowImage ? "cursor-zoom-in" : "cursor-default",
          className
        )}
        style={{ width: size, height: size }}
        aria-label={canShowImage && enableLightbox ? "Otevřít náhled obrázku" : "Náhled"}
        onClick={() => {
          if (!enableLightbox || !canShowImage) return;
          setOpen(true);
        }}
      >
        {canShowImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- externí Storage URL
          <img
            src={url}
            alt=""
            width={size}
            height={size}
            className="h-full w-full object-contain"
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 px-2 text-center">
            <Package
              className="text-slate-400"
              style={{ width: iconSize, height: iconSize }}
              strokeWidth={1.5}
            />
            <span className="text-[10px] leading-tight text-slate-500">
              Bez obrázku
            </span>
          </div>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] max-w-[96vw] overflow-hidden border-slate-200 bg-white p-0 text-black sm:max-w-4xl">
          <DialogHeader className="border-b border-slate-100 px-4 py-3">
            <DialogTitle className="text-base">{title}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center bg-black/5 p-3">
            {canShowImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt=""
                className="max-h-[78vh] w-auto max-w-full object-contain"
                decoding="async"
              />
            ) : (
              <div className="p-8 text-sm text-slate-700">Bez obrázku</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
