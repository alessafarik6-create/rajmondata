"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { Firestore } from "firebase/firestore";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import {
  useDoc,
  useMemoFirebase,
} from "@/firebase";
import {
  documentAnnotationDocId,
  newItemId,
  parseDocumentAnnotationDoc,
  serializePayload,
  type AnnotationStrokeColor,
  type CustomerOverlayItem,
  type DocumentAnnotationFirestoreDoc,
  type DocumentAnnotationStoragePath,
  type ThreadNote,
} from "@/lib/document-customer-annotations";
import {
  deserializeJobPhotoAnnotations,
  type JobPhotoAnnotation,
} from "@/lib/job-photo-annotations";
import { drawNoteAnnotationOnCanvas } from "@/lib/job-photo-annotation-canvas";
import type { JobPhotoDimensionAnnotation, JobPhotoNoteAnnotation } from "@/lib/job-photo-annotations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Eraser,
  Highlighter,
  Minus,
  Pencil,
  Redo2,
  Save,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Tool = "pan" | "draw" | "line" | "text" | "highlight" | "erase";

function colorHex(c: AnnotationStrokeColor): string {
  switch (c) {
    case "blue":
      return "#2563eb";
    case "yellow":
      return "#ca8a04";
    default:
      return "#dc2626";
  }
}

function dimColorHex(c: string): string {
  switch (c) {
    case "yellow":
      return "#eab308";
    case "white":
      return "#f8fafc";
    case "black":
      return "#111827";
    case "blue":
      return "#3b82f6";
    default:
      return "#ef4444";
  }
}

function scaleSizes(cw: number, ch: number) {
  const m = Math.max(320, Math.min(cw, ch));
  return {
    fontSize: Math.round(Math.max(11, Math.min(22, m * 0.028))),
    lineWidth: Math.max(2, Math.round(m * 0.004)),
    endpointRadius: Math.max(5, Math.round(m * 0.01)),
    arrowLen: Math.max(10, Math.round(m * 0.02)),
  };
}

function drawDimensionOnCtx(
  ctx: CanvasRenderingContext2D,
  a: JobPhotoDimensionAnnotation,
  cw: number,
  ch: number
) {
  const { fontSize, lineWidth, endpointRadius, arrowLen } = scaleSizes(cw, ch);
  const stroke = dimColorHex(a.color);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;

  const drawArrowHead = (x: number, y: number, ang: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x - arrowLen * Math.cos(ang - Math.PI / 6),
      y - arrowLen * Math.sin(ang - Math.PI / 6)
    );
    ctx.lineTo(
      x - arrowLen * Math.cos(ang + Math.PI / 6),
      y - arrowLen * Math.sin(ang + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  };

  ctx.beginPath();
  ctx.moveTo(a.startX, a.startY);
  ctx.lineTo(a.endX, a.endY);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(a.startX, a.startY, endpointRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(a.endX, a.endY, endpointRadius, 0, Math.PI * 2);
  ctx.fill();
  const angle = Math.atan2(a.endY - a.startY, a.endX - a.startX);
  drawArrowHead(a.startX, a.startY, angle + Math.PI);
  drawArrowHead(a.endX, a.endY, angle);
  const label = (a.label || "").trim();
  if (label) {
    const midX = (a.startX + a.endX) / 2;
    const midY = (a.startY + a.endY) / 2;
    const paddingX = Math.round(fontSize * 0.6);
    const paddingY = Math.round(fontSize * 0.45);
    const offset = Math.round(fontSize * 0.6);
    ctx.font = `700 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    const tw = ctx.measureText(label).width;
    const boxW = tw + paddingX * 2;
    const boxH = fontSize + paddingY * 2;
    const boxX = midX - boxW / 2;
    const boxY = midY - boxH / 2 - offset;
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, boxX + paddingX, boxY + paddingY + fontSize);
  }
}

function distToSeg(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function hitTestItem(
  x: number,
  y: number,
  it: CustomerOverlayItem,
  cw: number,
  ch: number,
  page: number
): boolean {
  if (it.page !== page) return false;
  const thr = 14;
  if (it.type === "line") {
    const x1 = it.x1 * cw,
      y1 = it.y1 * ch,
      x2 = it.x2 * cw,
      y2 = it.y2 * ch;
    return distToSeg(x, y, x1, y1, x2, y2) < thr;
  }
  if (it.type === "draw") {
    const pts = it.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i];
      if (distToSeg(x, y, a[0] * cw, a[1] * ch, b[0] * cw, b[1] * ch) < thr)
        return true;
    }
    return false;
  }
  if (it.type === "highlight") {
    const x1 = Math.min(it.x1, it.x2) * cw,
      y1 = Math.min(it.y1, it.y2) * ch,
      x2 = Math.max(it.x1, it.x2) * cw,
      y2 = Math.max(it.y1, it.y2) * ch;
    return x >= x1 - thr && x <= x2 + thr && y >= y1 - thr && y <= y2 + thr;
  }
  if (it.type === "text") {
    const tx = it.x * cw,
      ty = it.y * ch,
      tw = it.w * cw,
      th = it.h * ch;
    return x >= tx && x <= tx + tw && y >= ty && y <= ty + th;
  }
  return false;
}

function drawOverlayItems(
  ctx: CanvasRenderingContext2D,
  items: CustomerOverlayItem[],
  cw: number,
  ch: number,
  page: number,
  selectedId: string | null
) {
  for (const it of items) {
    if (it.page !== page) continue;
    const sel = it.id === selectedId;
    ctx.strokeStyle = colorHex(it.color);
    ctx.fillStyle = colorHex(it.color);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (it.type === "draw") {
      ctx.globalAlpha = 1;
      ctx.lineWidth = sel ? 4 : 3;
      ctx.beginPath();
      const p0 = it.points[0];
      if (!p0) continue;
      ctx.moveTo(p0[0] * cw, p0[1] * ch);
      for (let i = 1; i < it.points.length; i++) {
        ctx.lineTo(it.points[i][0] * cw, it.points[i][1] * ch);
      }
      ctx.stroke();
    } else if (it.type === "line") {
      ctx.globalAlpha = 1;
      ctx.lineWidth = sel ? 4 : 3;
      ctx.beginPath();
      ctx.moveTo(it.x1 * cw, it.y1 * ch);
      ctx.lineTo(it.x2 * cw, it.y2 * ch);
      ctx.stroke();
    } else if (it.type === "highlight") {
      ctx.globalAlpha = 0.35;
      const x1 = Math.min(it.x1, it.x2) * cw,
        y1 = Math.min(it.y1, it.y2) * ch,
        x2 = Math.max(it.x1, it.x2) * cw,
        y2 = Math.max(it.y1, it.y2) * ch;
      ctx.fillStyle = colorHex(it.color);
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    } else if (it.type === "text") {
      const tx = it.x * cw,
        ty = it.y * ch,
        tw = it.w * cw,
        th = it.h * ch;
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillRect(tx, ty, tw, th);
      ctx.strokeStyle = sel ? colorHex(it.color) : "rgba(0,0,0,0.35)";
      ctx.lineWidth = sel ? 2 : 1;
      ctx.strokeRect(tx, ty, tw, th);
      ctx.fillStyle = "#111827";
      const fs = Math.max(12, Math.min(th * 0.55, 18));
      ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
      const pad = 4;
      const lines = (it.text || "").split("\n").slice(0, 6);
      let ly = ty + pad + fs;
      for (const ln of lines) {
        if (ly > ty + th - pad) break;
        ctx.fillText(ln.slice(0, 80), tx + pad, ly);
        ly += fs * 1.15;
      }
    }
  }
  ctx.globalAlpha = 1;
}

export type CustomerMediaAnnotationViewerProps = {
  open: boolean;
  onClose: () => void;
  companyId: string;
  jobId: string;
  firestore: Firestore;
  userId: string;
  /** customer = jen vlastní úpravy dle readOnly; admin/manager/… může přidávat firemní vrstvu */
  actorRole: string;
  mediaUrl: string;
  title: string;
  fileType: "image" | "pdf";
  readOnly: boolean;
  storagePath: DocumentAnnotationStoragePath;
  mediaDocumentId: string;
  /** Interní kóty z dokumentu média (read-only vrstva) */
  embeddedAnnotationData?: unknown;
};

export function CustomerMediaAnnotationViewer({
  open,
  onClose,
  companyId,
  jobId,
  firestore,
  userId,
  actorRole,
  mediaUrl,
  title,
  fileType,
  readOnly,
  storagePath,
  mediaDocumentId,
  embeddedAnnotationData,
}: CustomerMediaAnnotationViewerProps) {
  const { toast } = useToast();
  const docId = useMemo(
    () => documentAnnotationDocId(storagePath, mediaDocumentId),
    [storagePath, mediaDocumentId]
  );

  const annRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId,
            "document_annotations",
            docId
          )
        : null,
    [firestore, companyId, jobId, docId]
  );

  const { data: annRemote } = useDoc(annRef);
  const loadedKey = useRef<string>("");

  const [tool, setTool] = useState<Tool>("draw");
  const [strokeColor, setStrokeColor] = useState<AnnotationStrokeColor>("red");
  const [items, setItems] = useState<CustomerOverlayItem[]>([]);
  const itemsRef = useRef<CustomerOverlayItem[]>([]);
  const undoStackRef = useRef<CustomerOverlayItem[][]>([[]]);
  const undoPtrRef = useRef(0);
  const [, histBump] = useReducer((n: number) => n + 1, 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfNumPages, setPdfNumPages] = useState(0);
  const [contentSize, setContentSize] = useState({ w: 800, h: 600 });
  const [lineDraft, setLineDraft] = useState<{ x: number; y: number } | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [textPos, setTextPos] = useState<{ nx: number; ny: number } | null>(null);
  const [noteInput, setNoteInput] = useState("");

  const viewportRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const midCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawBuf = useRef<{ page: number; pts: [number, number][] } | null>(null);
  const panDrag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const pdfRef = useRef<{ destroy?: () => void } | null>(null);

  const pushHistory = useCallback((next: CustomerOverlayItem[]) => {
    const stack = undoStackRef.current.slice(0, undoPtrRef.current + 1);
    stack.push(JSON.parse(JSON.stringify(next)) as CustomerOverlayItem[]);
    const trimmed = stack.slice(-40);
    undoStackRef.current = trimmed;
    undoPtrRef.current = trimmed.length - 1;
    setItems(next);
    histBump();
  }, []);

  const undo = useCallback(() => {
    if (undoPtrRef.current <= 0) return;
    undoPtrRef.current--;
    setItems(
      JSON.parse(JSON.stringify(undoStackRef.current[undoPtrRef.current])) as CustomerOverlayItem[]
    );
    histBump();
  }, []);

  const redo = useCallback(() => {
    if (undoPtrRef.current >= undoStackRef.current.length - 1) return;
    undoPtrRef.current++;
    setItems(
      JSON.parse(JSON.stringify(undoStackRef.current[undoPtrRef.current])) as CustomerOverlayItem[]
    );
    histBump();
  }, []);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!open) {
      loadedKey.current = "";
      setPdfPage(1);
      setPdfNumPages(0);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setSelectedId(null);
      setLineDraft(null);
      setTextPos(null);
      setTextDraft("");
      return;
    }
    const raw = annRemote as Record<string, unknown> | null | undefined;
    const key = `${docId}:${raw?.updatedAt ? JSON.stringify(raw.updatedAt) : "0"}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    const p = parseDocumentAnnotationDoc(raw);
    const initial = p?.items ?? [];
    const snap = JSON.parse(JSON.stringify(initial)) as CustomerOverlayItem[];
    undoStackRef.current = [snap];
    undoPtrRef.current = 0;
    setItems(initial);
    histBump();
  }, [open, docId, annRemote]);

  const embeddedItems = useMemo((): JobPhotoAnnotation[] => {
    if (!embeddedAnnotationData || fileType !== "image") return [];
    const w = Math.max(1, contentSize.w);
    const h = Math.max(1, contentSize.h);
    return deserializeJobPhotoAnnotations(embeddedAnnotationData, w, h);
  }, [embeddedAnnotationData, fileType, contentSize.w, contentSize.h]);

  useEffect(() => {
    if (!open || fileType !== "image") return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth || 800;
      const h = img.naturalHeight || 600;
      setContentSize({ w, h });
    };
    img.src = mediaUrl;
  }, [open, fileType, mediaUrl]);

  useEffect(() => {
    if (!open || fileType !== "pdf") return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const ver = pdfjs.version || "4.10.38";
        const major = Number(String(ver).split(".")[0] || "4");
        pdfjs.GlobalWorkerOptions.workerSrc =
          major === 3
            ? "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
            : `https://unpkg.com/pdfjs-dist@${ver}/build/pdf.worker.min.mjs`;
        console.log("PDF URL:", mediaUrl);
        console.log("PDF worker:", pdfjs.GlobalWorkerOptions.workerSrc);
        const task = pdfjs.getDocument(mediaUrl);
        const pdf = await task.promise;
        if (cancelled) return;
        console.log("PDF loaded:", pdf);
        pdfRef.current = pdf;
        setPdfNumPages(pdf.numPages);
        setPdfPage(1);
      } catch (e) {
        console.error(e);
        toast({
          variant: "destructive",
          title: "PDF se nepodařilo načíst",
          description: "Zkuste soubor stáhnout a otevřít lokálně.",
        });
      }
    })();
    return () => {
      cancelled = true;
      try {
        (pdfRef.current as { destroy?: () => void } | null)?.destroy?.();
      } catch {
        /* */
      }
      pdfRef.current = null;
    };
  }, [open, fileType, mediaUrl, toast]);

  useEffect(() => {
    if (!open || fileType !== "pdf" || !pdfRef.current || pdfNumPages < 1) return;
    const pdf = pdfRef.current as {
      getPage: (n: number) => Promise<{
        getViewport: (o: { scale: number }) => { width: number; height: number };
        render: (o: {
          canvasContext: CanvasRenderingContext2D;
          viewport: { width: number; height: number };
        }) => { promise: Promise<void> };
      }>;
    };
    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(pdfPage);
      console.log("page:", page);
      if (cancelled) return;
      const scale = 1.4;
      const vp = page.getViewport({ scale });
      const w = Math.round(vp.width);
      const h = Math.round(vp.height);
      setContentSize({ w, h });
      const canvas = baseCanvasRef.current;
      if (!canvas) return;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    })();
    return () => {
      cancelled = true;
    };
  }, [open, fileType, pdfPage, pdfNumPages]);

  const redrawMidAndOverlay = useCallback(() => {
    const cw = contentSize.w;
    const ch = contentSize.h;
    const mid = midCanvasRef.current;
    const ov = overlayCanvasRef.current;
    if (!mid || !ov) return;
    mid.width = cw;
    mid.height = ch;
    ov.width = cw;
    ov.height = ch;
    const mctx = mid.getContext("2d");
    const octx = ov.getContext("2d");
    if (!mctx || !octx) return;
    mctx.clearRect(0, 0, cw, ch);
    octx.clearRect(0, 0, cw, ch);
    const pageIdx = fileType === "pdf" ? pdfPage - 1 : 0;
    for (const a of embeddedItems) {
      if (a.type === "dimension") {
        drawDimensionOnCtx(mctx, a as JobPhotoDimensionAnnotation, cw, ch);
      } else if (a.type === "note") {
        drawNoteAnnotationOnCanvas(mctx, mid, a as JobPhotoNoteAnnotation, false, {
          ...scaleSizes(cw, ch),
          colorToHex: dimColorHex,
        });
      }
    }
    drawOverlayItems(octx, items, cw, ch, pageIdx, selectedId);
  }, [contentSize, embeddedItems, items, selectedId, fileType, pdfPage]);

  useEffect(() => {
    if (!open) return;
    redrawMidAndOverlay();
  }, [open, redrawMidAndOverlay]);

  const clientToContent = useCallback(
    (clientX: number, clientY: number) => {
      const vp = viewportRef.current;
      if (!vp) return { x: 0, y: 0 };
      const r = vp.getBoundingClientRect();
      const vx = clientX - r.left;
      const vy = clientY - r.top;
      const x = (vx - pan.x) / zoom;
      const y = (vy - pan.y) / zoom;
      return { x, y };
    },
    [pan, zoom]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (!open || readOnly) return;
    const { x, y } = clientToContent(e.clientX, e.clientY);
    const cw = contentSize.w;
    const ch = contentSize.h;
    const pageIdx = fileType === "pdf" ? pdfPage - 1 : 0;

    if (e.button === 1 || (e.button === 0 && tool === "pan")) {
      panDrag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (tool === "erase") {
      const cur = itemsRef.current;
      const idx = [...cur]
        .map((it, i) => ({ it, i }))
        .reverse()
        .find(({ it }) => hitTestItem(x, y, it, cw, ch, pageIdx));
      if (idx) {
        const next = cur.filter((_, j) => j !== idx.i);
        pushHistory(next);
        setSelectedId(null);
      }
      return;
    }

    if (tool === "line" || tool === "highlight") {
      const nx = x / cw,
        ny = y / ch;
      if (!lineDraft) {
        setLineDraft({ x: nx, y: ny });
      } else {
        const base = {
          id: newItemId(),
          color: strokeColor,
          page: pageIdx,
          notes: [] as ThreadNote[],
        };
        if (tool === "line") {
          pushHistory([
            ...itemsRef.current,
            {
              ...base,
              type: "line",
              x1: lineDraft.x,
              y1: lineDraft.y,
              x2: nx,
              y2: ny,
            },
          ]);
        } else {
          pushHistory([
            ...itemsRef.current,
            {
              ...base,
              type: "highlight",
              x1: lineDraft.x,
              y1: lineDraft.y,
              x2: nx,
              y2: ny,
            },
          ]);
        }
        setLineDraft(null);
      }
      return;
    }

    if (tool === "text") {
      setTextPos({ nx: x / cw, ny: y / ch });
      setTextDraft("");
      return;
    }

    if (tool === "draw") {
      drawBuf.current = {
        page: pageIdx,
        pts: [[Math.max(0, Math.min(1, x / cw)), Math.max(0, Math.min(1, y / ch))]],
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (panDrag.current) {
      const d = panDrag.current;
      setPan({
        x: d.px + (e.clientX - d.sx),
        y: d.py + (e.clientY - d.sy),
      });
      return;
    }
    if (!drawBuf.current || readOnly) return;
    const { x, y } = clientToContent(e.clientX, e.clientY);
    const cw = contentSize.w,
      ch = contentSize.h;
    drawBuf.current.pts.push([
      Math.max(0, Math.min(1, x / cw)),
      Math.max(0, Math.min(1, y / ch)),
    ]);
    const octx = overlayCanvasRef.current?.getContext("2d");
    if (octx) {
      redrawMidAndOverlay();
      const pageIdx = fileType === "pdf" ? pdfPage - 1 : 0;
      const draft = drawBuf.current;
      if (draft && draft.page === pageIdx) {
        octx.strokeStyle = colorHex(strokeColor);
        octx.lineWidth = 3;
        octx.lineCap = "round";
        octx.beginPath();
        const p0 = draft.pts[0];
        octx.moveTo(p0[0] * cw, p0[1] * ch);
        for (let i = 1; i < draft.pts.length; i++) {
          octx.lineTo(draft.pts[i][0] * cw, draft.pts[i][1] * ch);
        }
        octx.stroke();
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (panDrag.current) {
      panDrag.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* */
      }
      return;
    }
    if (drawBuf.current && !readOnly) {
      const draft = drawBuf.current;
      drawBuf.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* */
      }
      if (draft.pts.length >= 2) {
        pushHistory([
          ...itemsRef.current,
          {
            id: newItemId(),
            type: "draw",
            color: strokeColor,
            page: draft.page,
            points: draft.pts,
            notes: [],
          },
        ]);
      }
    }
  };

  const onOverlayClick = (e: React.MouseEvent) => {
    if (
      !readOnly &&
      (tool === "draw" ||
        tool === "line" ||
        tool === "highlight" ||
        tool === "text" ||
        tool === "erase")
    ) {
      return;
    }
    const { x, y } = clientToContent(e.clientX, e.clientY);
    const pageIdx = fileType === "pdf" ? pdfPage - 1 : 0;
    const hit = [...items]
      .map((it, i) => ({ it, i }))
      .reverse()
      .find(({ it }) => hitTestItem(x, y, it, contentSize.w, contentSize.h, pageIdx));
    setSelectedId(hit ? hit.it.id : null);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const dz = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom((z) => Math.min(4, Math.max(0.35, z + dz)));
  };

  const save = async () => {
    if (!annRef || readOnly) return;
    setSaving(true);
    try {
      const payload = serializePayload(items);
      const row: DocumentAnnotationFirestoreDoc = {
        companyId,
        jobId,
        documentId: mediaDocumentId,
        targetKind: storagePath.kind === "photos" ? "photos" : "folderImages",
        folderId: storagePath.kind === "folderImages" ? storagePath.folderId : undefined,
        imageId: storagePath.kind === "folderImages" ? mediaDocumentId : undefined,
        photoId: storagePath.kind === "photos" ? mediaDocumentId : undefined,
        mediaKind: fileType,
        type: "customer_overlay",
        data: payload,
        visibleFor: ["customer", "admin"],
        updatedBy: userId,
      };
      await setDoc(annRef, { ...row, updatedAt: serverTimestamp() }, { merge: true });
      toast({ title: "Uloženo", description: "Anotace byly uloženy." });
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Uložení selhalo",
        description: "Zkontrolujte připojení nebo oprávnění.",
      });
    } finally {
      setSaving(false);
    }
  };

  const commitText = () => {
    if (!textPos || !textDraft.trim()) {
      setTextPos(null);
      return;
    }
    const pageIdx = fileType === "pdf" ? pdfPage - 1 : 0;
    pushHistory([
      ...itemsRef.current,
      {
        id: newItemId(),
        type: "text",
        color: strokeColor,
        page: pageIdx,
        x: textPos.nx,
        y: textPos.ny,
        w: 0.22,
        h: 0.06,
        text: textDraft.trim(),
        notes: [],
      },
    ]);
    setTextPos(null);
    setTextDraft("");
  };

  const addThreadNote = () => {
    if (!selectedId || !noteInput.trim()) return;
    const note: ThreadNote = {
      id: newItemId(),
      text: noteInput.trim(),
      createdBy: userId,
      createdAt: Date.now(),
    };
    const next = itemsRef.current.map((it) =>
      it.id === selectedId ? { ...it, notes: [...it.notes, note] } : it
    );
    pushHistory(next);
    setNoteInput("");
  };

  const selected = items.find((x) => x.id === selectedId) ?? null;

  if (!open) return null;

  const toolbarBtn = (t: Tool, icon: React.ReactNode, label: string) => (
    <Button
      type="button"
      size="sm"
      variant={tool === t ? "default" : "outline"}
      className={cn("h-9 gap-1 px-2", readOnly && t !== "pan" && "pointer-events-none opacity-50")}
      disabled={readOnly && t !== "pan"}
      onClick={() => setTool(t)}
      title={label}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/90 text-white">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>
        <div className="flex flex-wrap items-center gap-1">
          {toolbarBtn("draw", <Pencil className="h-4 w-4" />, "Kreslit")}
          {toolbarBtn("line", <Minus className="h-4 w-4 rotate-[-45deg]" />, "Čára")}
          {toolbarBtn("text", <Type className="h-4 w-4" />, "Text")}
          {toolbarBtn("highlight", <Highlighter className="h-4 w-4" />, "Zvýraznit")}
          {toolbarBtn("erase", <Eraser className="h-4 w-4" />, "Smazat")}
          {toolbarBtn("pan", <span className="text-xs">✋</span>, "Posun")}
        </div>
        <div className="flex items-center gap-1 border-l border-white/15 pl-2">
          {(["red", "blue", "yellow"] as const).map((c) => (
            <button
              key={c}
              type="button"
              disabled={readOnly}
              className={cn(
                "h-7 w-7 rounded-full border-2",
                strokeColor === c ? "border-white" : "border-transparent opacity-80"
              )}
              style={{ backgroundColor: colorHex(c) }}
              onClick={() => setStrokeColor(c)}
              aria-label={c}
            />
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 border-white/30 text-white hover:bg-white/10"
          disabled={readOnly || saving}
          onClick={() => void save()}
        >
          <Save className="h-4 w-4" />
          {saving ? "Ukládám…" : "Uložit"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-9 text-white hover:bg-white/10"
          disabled={readOnly || undoPtrRef.current <= 0}
          onClick={undo}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-9 text-white hover:bg-white/10"
          disabled={
            readOnly || undoPtrRef.current >= undoStackRef.current.length - 1
          }
          onClick={redo}
        >
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-9 w-9 shrink-0 text-white hover:bg-white/10"
          onClick={onClose}
          aria-label="Zavřít"
        >
          <X className="h-5 w-5" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          ref={viewportRef}
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden md:min-h-[200px]"
          onWheel={onWheel}
        >
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex gap-1 rounded-md bg-black/50 p-1 text-xs text-white/90">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-white hover:bg-white/15"
              onClick={() => setZoom((z) => Math.min(4, z + 0.15))}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-white hover:bg-white/15"
              onClick={() => setZoom((z) => Math.max(0.35, z - 0.15))}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="flex items-center px-1 tabular-nums">{Math.round(zoom * 100)}%</span>
          </div>
          {fileType === "pdf" && pdfNumPages > 1 ? (
            <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-md bg-black/50 px-2 py-1 text-sm">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 text-white hover:bg-white/15"
                disabled={pdfPage <= 1}
                onClick={() => setPdfPage((p) => Math.max(1, p - 1))}
              >
                ←
              </Button>
              <span>
                Strana {pdfPage} / {pdfNumPages}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 text-white hover:bg-white/15"
                disabled={pdfPage >= pdfNumPages}
                onClick={() => setPdfPage((p) => Math.min(pdfNumPages, p + 1))}
              >
                →
              </Button>
            </div>
          ) : null}

          <div
            className="flex h-full w-full items-center justify-center"
            style={{ cursor: tool === "pan" ? "grab" : "default" }}
          >
            <div
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
              }}
              className="relative"
            >
              {fileType === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl}
                  alt=""
                  className="absolute left-0 top-0 max-h-[85vh] max-w-[90vw] object-contain"
                  style={{ width: contentSize.w, height: contentSize.h }}
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    setContentSize({
                      w: el.naturalWidth || contentSize.w,
                      h: el.naturalHeight || contentSize.h,
                    });
                  }}
                />
              ) : null}
              <canvas
                ref={baseCanvasRef}
                className={cn(
                  "block max-h-[85vh] max-w-[90vw]",
                  fileType === "image" && "pointer-events-none opacity-0"
                )}
                style={{ width: contentSize.w, height: contentSize.h }}
              />
              <canvas
                ref={midCanvasRef}
                className="pointer-events-none absolute left-0 top-0"
                style={{ width: contentSize.w, height: contentSize.h }}
              />
              <canvas
                ref={overlayCanvasRef}
                className="absolute left-0 top-0 touch-none"
                style={{
                  width: contentSize.w,
                  height: contentSize.h,
                  cursor:
                    tool === "draw"
                      ? "crosshair"
                      : tool === "erase"
                        ? "cell"
                        : tool === "pan"
                          ? "grab"
                          : "pointer",
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
                onClick={onOverlayClick}
              />
            </div>
          </div>
        </div>

        <aside className="flex max-h-[min(38vh,320px)] w-full shrink-0 flex-col border-t border-white/10 bg-black/40 md:max-h-none md:w-[280px] md:border-l md:border-t-0">
          <div className="border-b border-white/10 p-3 text-sm font-medium">Poznámky</div>
          <ScrollArea className="flex-1 p-3">
            {readOnly ? (
              <p className="text-xs text-white/70">Prohlížení — úpravy nejsou povoleny.</p>
            ) : (
              <p className="text-xs text-white/70">
                Vyberte čáru nebo tvar kliknutím (režim kreslení vypněte / použijte Smazat jen pro
                mazání). Přidejte poznámku k vybranému prvku.
              </p>
            )}
            {items.length === 0 && !embeddedItems.length ? (
              <p className="mt-4 text-sm text-white/60">Zatím nejsou žádné poznámky.</p>
            ) : null}
            {selected ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs text-white/60">Vybraný prvek ({selected.type})</p>
                <ul className="space-y-1 text-xs">
                  {selected.notes.map((n) => (
                    <li key={n.id} className="rounded border border-white/10 bg-white/5 p-2">
                      {n.text}
                      <div className="mt-1 text-[10px] text-white/45">
                        {new Date(n.createdAt).toLocaleString("cs-CZ")}
                      </div>
                    </li>
                  ))}
                </ul>
                {!readOnly ? (
                  <div className="space-y-2">
                    <Input
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      placeholder="Poznámka k prvku…"
                      className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="w-full"
                      disabled={!noteInput.trim()}
                      onClick={addThreadNote}
                    >
                      Přidat poznámku
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-xs text-white/50">
                Kliknutím na nakreslený tvar zobrazíte vlákno poznámek.
              </p>
            )}
          </ScrollArea>
          {textPos && !readOnly ? (
            <div className="border-t border-white/10 p-3">
              <p className="mb-2 text-xs text-white/70">Text na výkresu</p>
              <Input
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                className="mb-2 border-white/20 bg-white/10 text-white"
                placeholder="Text…"
                autoFocus
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={commitText}>
                  Vložit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-white"
                  onClick={() => setTextPos(null)}
                >
                  Zrušit
                </Button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
      <p className="shrink-0 border-t border-white/10 px-3 py-1 text-center text-[11px] text-white/50">
        Ctrl + kolečko myši = zoom · Posun = režim ✋ nebo prostřední tlačítko · Role: {actorRole}
      </p>
    </div>
  );
}
