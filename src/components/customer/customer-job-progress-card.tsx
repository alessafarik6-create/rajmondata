"use client";

import React, { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Images } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { CustomerProgressImage } from "@/lib/job-customer-progress";
import {
  filterCustomerVisibleProgressImages,
  normalizeCompletionPercent,
  parseCustomerProgressImages,
} from "@/lib/job-customer-progress";

const AUTOPLAY_MS = 6000;

export type CustomerJobProgressCardProps = {
  jobId: string;
  jobName: string;
  /** Raw z Firestore dokumentu zakázky */
  jobData: Record<string, unknown> | null | undefined;
  className?: string;
  /** Když false, nezobrazí Card obal (jen vnitřek) — pro vnoření */
  withCard?: boolean;
};

export function deriveCustomerProgressFromJob(
  jobData: Record<string, unknown> | null | undefined
): { percent: number; images: CustomerProgressImage[] } {
  if (!jobData) {
    return { percent: 0, images: [] };
  }
  const percent = normalizeCompletionPercent(jobData.completionPercent);
  const images = filterCustomerVisibleProgressImages(
    parseCustomerProgressImages(jobData.customerProgressImages)
  );
  return { percent, images };
}

export function CustomerJobProgressCard({
  jobId,
  jobName,
  jobData,
  className,
  withCard = true,
}: CustomerJobProgressCardProps) {
  const { percent, images } = deriveCustomerProgressFromJob(jobData);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [jobId, images.length]);

  const slides = images;
  const hasSlides = slides.length > 0;
  const safeIndex = hasSlides ? Math.min(index, slides.length - 1) : 0;
  const current = hasSlides ? slides[safeIndex] : null;

  const goPrev = useCallback(() => {
    if (!slides.length) return;
    setIndex((i) => (i - 1 + slides.length) % slides.length);
  }, [slides.length]);

  const goNext = useCallback(() => {
    if (!slides.length) return;
    setIndex((i) => (i + 1) % slides.length);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const t = window.setInterval(goNext, AUTOPLAY_MS);
    return () => window.clearInterval(t);
  }, [slides.length, goNext]);

  const inner = (
    <div className="space-y-4">
      <div>
        {!withCard ? (
          <h3 className="text-base font-semibold leading-tight">{jobName || "Zakázka"}</h3>
        ) : null}
        <div
          className={cn(
            "flex flex-wrap items-baseline justify-between gap-2",
            withCard ? "mt-0" : "mt-2"
          )}
        >
          <span className="text-sm text-muted-foreground">Dokončení zakázky</span>
          <span className="text-sm font-semibold tabular-nums text-foreground">{percent} %</span>
        </div>
        <Progress value={percent} className="mt-2 h-3" />
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Fotky a vizualizace
        </p>
        {!hasSlides ? (
          <div
            className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground"
            role="status"
          >
            <Images className="h-10 w-10 opacity-50" aria-hidden />
            <p>Zatím nebyly přidány žádné fotografie průběhu zakázky.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative overflow-hidden rounded-lg border bg-muted/20">
              <div className="relative flex min-h-[200px] max-h-[min(52vh,360px)] w-full items-center justify-center p-2 sm:min-h-[220px]">
                {current ? (
                  <>
                    <Image
                      src={current.url}
                      alt={current.title?.trim() || `Průběh zakázky — snímek ${safeIndex + 1}`}
                      width={1200}
                      height={800}
                      className="max-h-[min(52vh,360px)] w-auto max-w-full object-contain"
                      unoptimized
                    />
                    {slides.length > 1 ? (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="absolute left-1 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full shadow-md"
                          onClick={goPrev}
                          aria-label="Předchozí obrázek"
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full shadow-md"
                          onClick={goNext}
                          aria-label="Další obrázek"
                        >
                          <ChevronRight className="h-5 w-5" />
                        </Button>
                      </>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
            {current?.title?.trim() || current?.description?.trim() ? (
              <div className="text-sm">
                {current?.title?.trim() ? (
                  <p className="font-medium text-foreground">{current.title}</p>
                ) : null}
                {current?.description?.trim() ? (
                  <p className="text-muted-foreground">{current.description}</p>
                ) : null}
              </div>
            ) : null}
            {slides.length > 1 ? (
              <div className="flex justify-center gap-1.5 pt-1" role="tablist" aria-label="Výběr snímku">
                {slides.map((_, i) => (
                  <button
                    key={slides[i].id}
                    type="button"
                    className={cn(
                      "h-2 w-2 rounded-full transition-colors",
                      i === safeIndex ? "bg-primary" : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                    )}
                    aria-label={`Snímek ${i + 1} z ${slides.length}`}
                    aria-current={i === safeIndex ? "true" : undefined}
                    onClick={() => setIndex(i)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );

  if (!withCard) {
    return <div className={cn("space-y-4", className)}>{inner}</div>;
  }

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg leading-snug">{jobName || "Průběh zakázky"}</CardTitle>
        <CardDescription>Průběh realizace — fotky, vizualizace a stav dokončení.</CardDescription>
      </CardHeader>
      <CardContent>{inner}</CardContent>
    </Card>
  );
}
