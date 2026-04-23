"use client";

import { useState } from "react";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveInventoryItemImageUrl } from "@/lib/inventory-item-image";

type Props = {
  item: Record<string, unknown> | null | undefined;
  /** Velikost strany čtverce v px (výchozí 48). */
  size?: number;
  className?: string;
};

export function InventoryItemThumbnail({ item, size = 48, className }: Props) {
  const url = resolveInventoryItemImageUrl(item);
  const [broken, setBroken] = useState(false);
  const iconSize = Math.max(14, Math.round(size * 0.42));

  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center",
        className
      )}
      style={{ width: size, height: size }}
      aria-hidden={url && !broken ? undefined : true}
    >
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- externí Storage URL
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <Package className="text-slate-400" style={{ width: iconSize, height: iconSize }} strokeWidth={1.5} />
      )}
    </div>
  );
}
