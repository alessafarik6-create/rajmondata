"use client";

import React, { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Eraser, Loader2, Pencil } from "lucide-react";
import { signHandoverProtocol } from "@/lib/handover-protocol-client-api";

export function HandoverProtocolSignatureDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  protocolId: string;
  user: User;
  role: "customer" | "contractor";
  title?: string;
  onSigned?: () => void;
}) {
  const {
    open,
    onOpenChange,
    companyId,
    protocolId,
    user,
    role,
    title,
    onSigned,
  } = props;
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
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
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  }, [open]);

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
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  };

  const save = async () => {
    const c = canvasRef.current;
    if (!c) return;
    setSaving(true);
    try {
      const dataUrl = c.toDataURL("image/png");
      await signHandoverProtocol({
        user,
        companyId,
        protocolId,
        role,
        signatureDataUrl: dataUrl,
      });
      toast({
        title: role === "customer" ? "Podepsáno zákazníkem" : "Podpis zhotovitele uložen",
      });
      onOpenChange(false);
      onSigned?.();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Podpis se nezdařil",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(100vw-1.5rem,480px)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title ?? (role === "customer" ? "Podpis objednatele" : "Podpis zhotovitele")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Podpis proveďte prstem nebo stylusem (mobil / tablet) nebo myší.
        </p>
        <div className="rounded-md border border-slate-200 bg-white">
          <canvas
            ref={canvasRef}
            className="h-40 w-full touch-none cursor-crosshair"
            onPointerDown={(e) => {
              drawing.current = true;
              const ctx = canvasRef.current?.getContext("2d");
              if (!ctx) return;
              const p = pos(e);
              ctx.beginPath();
              ctx.moveTo(p.x, p.y);
              (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const ctx = canvasRef.current?.getContext("2d");
              if (!ctx) return;
              const p = pos(e);
              ctx.lineTo(p.x, p.y);
              ctx.stroke();
            }}
            onPointerUp={() => {
              drawing.current = false;
            }}
            onPointerLeave={() => {
              drawing.current = false;
            }}
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={clear}>
            <Eraser className="h-4 w-4 mr-1" />
            Vymazat
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Zrušit
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
            <span className="ml-2">Uložit podpis</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
