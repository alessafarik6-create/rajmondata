"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getAuth } from "firebase/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function companyApiUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

type Props = {
  companyId: string;
  signatureUrl?: string | null;
};

export function OrganizationSignatureSettingsCard(props: Props) {
  const { companyId, signatureUrl } = props;
  const { toast } = useToast();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const dpr = useMemo(() => (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1), []);

  const setupCanvas = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const cssW = Math.max(280, Math.round(rect.width));
    const cssH = 180;

    // Keep existing pixels if already drawn
    const prev = document.createElement("canvas");
    prev.width = canvas.width;
    prev.height = canvas.height;
    const prevCtx = prev.getContext("2d");
    if (prevCtx) prevCtx.drawImage(canvas, 0, 0);

    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctxRef.current = ctx;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0a0a0a";
    ctx.lineWidth = 2.2;

    // Transparent background; redraw previous if available
    ctx.clearRect(0, 0, cssW, cssH);
    if (prev.width && prev.height) {
      ctx.drawImage(prev, 0, 0, cssW, cssH);
    }
  };

  useEffect(() => {
    setupCanvas();
    if (typeof window === "undefined") return;
    const onResize = () => setupCanvas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cssW = Math.max(280, Math.round(rect.width));
    const cssH = 180;
    ctx.clearRect(0, 0, cssW, cssH);
    setHasDrawn(false);
  };

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return { x, y };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    setIsDrawing(true);
    const p = getCanvasPoint(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    const p = getCanvasPoint(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    try {
      (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setIsDrawing(false);
  };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!hasDrawn) {
      toast({
        variant: "destructive",
        title: "Podpis je prázdný",
        description: "Nejdřív se prosím podepište do pole.",
      });
      return;
    }
    setIsSaving(true);
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) throw new Error("Neplatné přihlášení.");
      const token = await user.getIdToken();

      const pngDataUrl = canvas.toDataURL("image/png");
      const res = await fetch(companyApiUrl("/api/company/organization-signature"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ companyId, pngDataUrl }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Uložení podpisu se nezdařilo.");
      }
      toast({ title: "Podpis uložen", description: "Bude automaticky použit do smluv." });
      clear();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nepodařilo se uložit podpis",
        description: e instanceof Error ? e.message : "Zkuste to prosím znovu.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async () => {
    setIsDeleting(true);
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) throw new Error("Neplatné přihlášení.");
      const token = await user.getIdToken();
      const url = companyApiUrl(`/api/company/organization-signature?companyId=${encodeURIComponent(companyId)}`);
      const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || "Odstranění se nezdařilo.");
      toast({ title: "Podpis odstraněn" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nepodařilo se odstranit podpis",
        description: e instanceof Error ? e.message : "Zkuste to prosím znovu.",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="bg-surface border-border">
      <CardHeader>
        <CardTitle>Elektronický podpis organizace</CardTitle>
        <CardDescription>
          Podpis se uloží jednou a automaticky se propíše do generovaných smluv na místo podpisu organizace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Podpisové pole</div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={clear} disabled={isSaving || isDeleting}>
                Vymazat
              </Button>
              <Button type="button" size="sm" onClick={() => void save()} disabled={isSaving || isDeleting || !companyId}>
                {isSaving ? "Ukládám…" : "Uložit podpis"}
              </Button>
            </div>
          </div>

          <div
            ref={containerRef}
            className={cn(
              "rounded-lg border border-border bg-white",
              "touch-none select-none",
              isSaving || isDeleting ? "opacity-70 pointer-events-none" : ""
            )}
          >
            <canvas
              ref={canvasRef}
              className="block w-full h-[180px]"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Tip: na mobilu/tabletu podepisujte prstem nebo perem. Podklad je průhledný (PNG).
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Uložený podpis</div>
            {signatureUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 text-destructive"
                disabled={isSaving || isDeleting}
                onClick={() => void remove()}
              >
                Odstranit
              </Button>
            ) : null}
          </div>
          {signatureUrl ? (
            <div className="rounded-lg border border-border bg-background p-3">
              <img
                src={signatureUrl}
                alt="Podpis organizace"
                className="h-14 max-w-[320px] object-contain bg-white"
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Podpis není nastaven.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

