"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { PlatformSeoHeroImage, PlatformSeoPromoVideo } from "@/lib/platform-seo-sanitize";
import { toYoutubeNocookieEmbedUrl } from "@/lib/youtube-nocookie-embed";

export function PublicAuthMediaPanel({
  images,
  video,
  title,
  subtitle,
  backLink,
  backLabel,
}: {
  images: PlatformSeoHeroImage[];
  video: PlatformSeoPromoVideo | null;
  title: string;
  subtitle: string;
  backLink?: string;
  backLabel?: React.ReactNode;
}) {
  const sorted = [...images]
    .filter((x) => x?.url?.trim())
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (sorted.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % sorted.length), 7000);
    return () => clearInterval(t);
  }, [sorted.length]);

  const v = video?.url?.trim() ? video : null;

  return (
    <div className="relative min-h-[200px] w-full overflow-hidden bg-slate-950 lg:min-h-screen">
      {sorted.length > 0 ? (
        <div className="absolute inset-0">
          {sorted.map((im, i) => (
            <div
              key={`${im.storagePath}-${i}`}
              className={`absolute inset-0 transition-opacity duration-700 ${
                i === idx ? "z-10 opacity-100" : "z-0 opacity-0 pointer-events-none"
              }`}
            >
              <Image
                src={im.url}
                alt={im.alt || ""}
                fill
                className="object-contain object-center"
                sizes="(max-width: 1024px) 100vw, 50vw"
                unoptimized
                priority={i === 0}
              />
            </div>
          ))}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30" />
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950" />
      )}

      <div className="relative z-20 flex min-h-[200px] flex-col justify-between p-5 sm:p-8 lg:min-h-screen lg:p-12">
        {backLink ? (
          <Link
            href={backLink}
            className="inline-flex w-fit items-center gap-2 text-sm font-medium text-white/90 hover:text-white"
          >
            {backLabel ?? "Zpět"}
          </Link>
        ) : (
          <span />
        )}

        <div className="mt-8 max-w-xl space-y-3 pb-6 lg:mt-auto">
          <h1 className="text-balance text-2xl font-bold leading-tight text-white sm:text-3xl lg:text-4xl">{title}</h1>
          <p className="text-sm leading-relaxed text-slate-200 sm:text-base lg:max-w-lg">{subtitle}</p>
        </div>
      </div>

      {v ? (
        <div className="relative z-10 border-t border-white/10 bg-black/40 p-4 lg:absolute lg:bottom-0 lg:left-0 lg:right-0 lg:border-t">
          <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-black/60 shadow-lg">
            {v.type === "embed" ? (
              (() => {
                const emb = toYoutubeNocookieEmbedUrl(v.url);
                return emb ? (
                  <iframe
                    title="Video"
                    src={emb}
                    className="aspect-video w-full"
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <p className="p-3 text-sm text-amber-200">Neplatný odkaz videa (použijte YouTube).</p>
                );
              })()
            ) : (
              <video className="aspect-video w-full bg-black" controls preload="metadata" playsInline src={v.url} />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
