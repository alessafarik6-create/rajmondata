"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Eraser, CheckCircle2 } from "lucide-react";

export default function PublicHandoverSignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    void params.then((p) => setToken(decodeURIComponent(p.token ?? "")));
  }, [params]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/public/handover-protocol/${encodeURIComponent(token)}`);
        const data = (await res.json()) as { ok?: boolean; html?: string; error?: string };
        if (!res.ok || !data.ok || !data.html) {
          throw new Error(data.error || "Protokol nelze načíst.");
        }
        if (!cancelled) setHtml(data.html);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Chyba načtení");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!html || done) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const rect = c.getBoundingClientRect();
    c.width = Math.floor(rect.width * 2);
    c.height = Math.floor(rect.height * 2);
    ctx.scale(2, 2);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
  }, [html, done]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const r = c.getBoundingClientRect();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(2, 2);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
  };

  const submit = async () => {
    const c = canvasRef.current;
    if (!c || !token) return;
    if (!signerName.trim()) {
      setError("Vyplňte jméno podepisující osoby.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const dataUrl = c.toDataURL("image/png");
      const res = await fetch(`/api/public/handover-protocol/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signatureDataUrl: dataUrl,
          signerName: signerName.trim(),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Podpis se nezdařil.");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Podpis se nezdařil.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-950 text-white">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 bg-slate-950 text-white p-6 text-center">
        <CheckCircle2 className="h-14 w-14 text-emerald-400" />
        <h1 className="text-xl font-semibold">Předávací protokol byl úspěšně podepsán a uložen k zakázce.</h1>
        <p className="text-sm text-slate-300 max-w-md">Děkujeme. Kopii obdržíte e-mailem od zhotovitele.</p>
      </div>
    );
  }

  if (error && !html) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-950 text-white p-6">
        <p className="text-center text-red-300">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-slate-100 text-slate-900 pb-safe">
      <header className="sticky top-0 z-10 bg-[#0b1f4a] text-white px-4 py-3 shadow">
        <p className="text-sm font-medium">RAJMONDATA — podpis předávacího protokolu</p>
      </header>
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {html ? (
          <div
            className="bg-white rounded-lg shadow border overflow-auto max-h-[50vh] p-2 text-sm"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : null}
        <div className="bg-white rounded-lg shadow border p-4 space-y-3 touch-manipulation">
          <div className="space-y-1">
            <Label htmlFor="signer">Jméno podepisující (zákazník) *</Label>
            <Input
              id="signer"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Jméno a příjmení"
              autoComplete="name"
            />
          </div>
          <Label>Podpis prstem nebo myší *</Label>
          <canvas
            ref={canvasRef}
            className="w-full h-40 border-2 border-dashed border-slate-300 rounded-md touch-none bg-white"
            onPointerDown={(e) => {
              drawing.current = true;
              (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
              const ctx = canvasRef.current?.getContext("2d");
              const p = pos(e);
              ctx?.beginPath();
              ctx?.moveTo(p.x, p.y);
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const ctx = canvasRef.current?.getContext("2d");
              const p = pos(e);
              ctx?.lineTo(p.x, p.y);
              ctx?.stroke();
            }}
            onPointerUp={() => {
              drawing.current = false;
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={clear}>
              <Eraser className="h-4 w-4 mr-1" />
              Smazat podpis
            </Button>
            <Button type="button" className="flex-1" disabled={saving} onClick={() => void submit()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Potvrdit podpis"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Jedná se o běžný elektronický podpis s auditní stopou, nikoli o kvalifikovaný elektronický
            podpis dle eIDAS.
          </p>
        </div>
      </div>
    </div>
  );
}
