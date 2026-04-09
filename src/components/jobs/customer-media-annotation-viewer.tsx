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
  readAnnotationPayloadReferenceSize,
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
  Ruler,
  Redo2,
  Save,
  Square,
  Circle,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { createCustomerActivity } from "@/lib/customer-activity";

type Tool =
  | "pan"
  | "draw"
  | "line"
  | "dimension"
  | "text"
  | "highlight"
  | "rectangle"
  | "square"
  | "circle"
  | "erase";
type ShapeTool = "rectangle" | "square" | "circle";

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

function pointXY(point: [number, number] | { x: number; y: number }): [number, number] {
  if (Array.isArray(point)) return [point[0], point[1]];
  return [point.x, point.y];
}

function isPrivilegedRole(role: string): boolean {
  const r = role.toLowerCase();
  return r === "owner" || r === "superadmin" || r === "admin" || r === "manager" || r === "accountant";
}

function canEditByPolicy(
  item: CustomerOverlayItem | null | undefined,
  userId: string,
  role: string,
  readOnly: boolean
): boolean {
  if (!item || readOnly) return false;
  if (isPrivilegedRole(role)) return true;
  return !!item.createdBy && item.createdBy === userId;
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
  if (it.type === "dimension") {
    const x1 = it.x1 * cw,
      y1 = it.y1 * ch,
      x2 = it.x2 * cw,
      y2 = it.y2 * ch;
    return distToSeg(x, y, x1, y1, x2, y2) < thr;
  }
  if (it.type === "rectangle" || it.type === "square" || it.type === "circle") {
    let x1 = it.x1 * cw,
      y1 = it.y1 * ch,
      x2 = it.x2 * cw,
      y2 = it.y2 * ch;
    if (it.type === "square" || it.type === "circle") {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const side = Math.min(Math.abs(dx), Math.abs(dy));
      x2 = x1 + Math.sign(dx || 1) * side;
      y2 = y1 + Math.sign(dy || 1) * side;
    }
    const rx = Math.min(x1, x2);
    const ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1);
    const rh = Math.abs(y2 - y1);
    if (it.type === "circle") {
      const cx = rx + rw / 2;
      const cy = ry + rh / 2;
      const r = Math.max(1, Math.min(rw, rh) / 2);
      return Math.hypot(x - cx, y - cy) <= r + thr;
    }
    return x >= rx - thr && x <= rx + rw + thr && y >= ry - thr && y <= ry + rh + thr;
  }
  if (it.type === "draw") {
    const pts = it.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i];
      const [ax, ay] = pointXY(a);
      const [bx, by] = pointXY(b);
      if (distToSeg(x, y, ax * cw, ay * ch, bx * cw, by * ch) < thr)
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
  selectedId: string | null,
  editableSelectedId: string | null,
  hoveredId: string | null
) {
  for (const it of items) {
    if (it.page !== page) continue;
    const sel = it.id === selectedId;
    const hov = it.id === hoveredId;
    ctx.strokeStyle = colorHex(it.color);
    ctx.fillStyle = colorHex(it.color);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (it.type === "draw") {
      ctx.globalAlpha = 1;
      ctx.lineWidth = sel ? 5 : hov ? 4 : 3;
      ctx.beginPath();
      const p0 = it.points[0];
      if (!p0) continue;
      const [p0x, p0y] = pointXY(p0);
      ctx.moveTo(p0x * cw, p0y * ch);
      for (let i = 1; i < it.points.length; i++) {
        const [px, py] = pointXY(it.points[i]);
        ctx.lineTo(px * cw, py * ch);
      }
      ctx.stroke();
    } else if (it.type === "line") {
      ctx.globalAlpha = 1;
      ctx.lineWidth = sel ? 5 : hov ? 4 : 3;
      ctx.beginPath();
      ctx.moveTo(it.x1 * cw, it.y1 * ch);
      ctx.lineTo(it.x2 * cw, it.y2 * ch);
      ctx.stroke();
      if (sel && it.id === editableSelectedId) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(it.x1 * cw, it.y1 * ch, 5, 0, Math.PI * 2);
        ctx.arc(it.x2 * cw, it.y2 * ch, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (it.type === "dimension") {
      ctx.globalAlpha = 1;
      ctx.lineWidth = sel ? 4 : hov ? 3 : 2;
      const x1 = it.x1 * cw,
        y1 = it.y1 * ch,
        x2 = it.x2 * cw,
        y2 = it.y2 * ch;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const len = 12;
      const drawArrow = (x: number, y: number, a: number) => {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - len * Math.cos(a - Math.PI / 7), y - len * Math.sin(a - Math.PI / 7));
        ctx.lineTo(x - len * Math.cos(a + Math.PI / 7), y - len * Math.sin(a + Math.PI / 7));
        ctx.closePath();
        ctx.fill();
      };
      drawArrow(x1, y1, ang + Math.PI);
      drawArrow(x2, y2, ang);
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const txt = (it.text || "").trim();
      if (txt) {
        ctx.font = "700 13px ui-sans-serif, system-ui, sans-serif";
        const tw = ctx.measureText(txt).width;
        const bw = tw + 12;
        const bh = 22;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(midX - bw / 2, midY - bh / 2 - 10, bw, bh);
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.strokeRect(midX - bw / 2, midY - bh / 2 - 10, bw, bh);
        ctx.fillStyle = "#fff";
        ctx.fillText(txt, midX - tw / 2, midY + 4 - 10);
      }
      if (sel && it.id === editableSelectedId) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(x1, y1, 5, 0, Math.PI * 2);
        ctx.arc(x2, y2, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (it.type === "highlight") {
      // Soft highlighter stroke (not an opaque block).
      const x1 = it.x1 * cw,
        y1 = it.y1 * ch,
        x2 = it.x2 * cw,
        y2 = it.y2 * ch;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = Math.max(12, (it.style?.lineWidth ?? 18) * (sel ? 1.15 : 1));
      ctx.strokeStyle = colorHex(it.color);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (sel && it.id === editableSelectedId) {
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    } else if (it.type === "text") {
      const tx = it.x * cw,
        ty = it.y * ch,
        tw = it.w * cw,
        th = it.h * ch;
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillRect(tx, ty, tw, th);
      ctx.strokeStyle = sel ? colorHex(it.color) : hov ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.35)";
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
    } else if (
      it.type === "rectangle" ||
      it.type === "square" ||
      it.type === "circle"
    ) {
      const rawX1 = it.x1 * cw;
      const rawY1 = it.y1 * ch;
      const rawX2 = it.x2 * cw;
      const rawY2 = it.y2 * ch;
      let x1 = rawX1;
      let y1 = rawY1;
      let x2 = rawX2;
      let y2 = rawY2;
      if (it.type === "square" || it.type === "circle") {
        const dx = rawX2 - rawX1;
        const dy = rawY2 - rawY1;
        const side = Math.min(Math.abs(dx), Math.abs(dy));
        x2 = rawX1 + Math.sign(dx || 1) * side;
        y2 = rawY1 + Math.sign(dy || 1) * side;
      }
      const rx = Math.min(x1, x2);
      const ry = Math.min(y1, y2);
      const rw = Math.abs(x2 - x1);
      const rh = Math.abs(y2 - y1);
      const lw = Math.max(1.5, it.style?.lineWidth ?? (sel ? 3 : 2));
      if (it.style?.fillColor) {
        ctx.fillStyle = it.style.fillColor;
        ctx.fillRect(rx, ry, rw, rh);
      }
      ctx.strokeStyle = colorHex(it.color);
      ctx.lineWidth = lw;
      if (it.type === "circle") {
        const cx = rx + rw / 2;
        const cy = ry + rh / 2;
        const r = Math.max(1, Math.min(rw, rh) / 2);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(rx, ry, rw, rh);
      }
      if (sel) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(rx, ry, 4.5, 0, Math.PI * 2);
        ctx.arc(rx + rw, ry + rh, 4.5, 0, Math.PI * 2);
        ctx.fill();
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
  /** Poznámka administrátora k souboru (ze složky / fotky). */
  adminNote?: string;
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
  adminNote,
}: CustomerMediaAnnotationViewerProps) {
  const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (!value || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  function sanitizeFirestorePayload<T>(value: T): T {
    if (Array.isArray(value)) {
      return value
        .map((v) => sanitizeFirestorePayload(v))
        .filter((v) => v !== undefined) as T;
    }
    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === undefined) continue;
        out[k] = sanitizeFirestorePayload(v);
      }
      return out as T;
    }
    return value;
  }

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
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfNumPages, setPdfNumPages] = useState(0);
  /** Rozlišení bitmapy (natural / canvas) — shodné s uloženými 0–1 souřadnicemi. */
  const [contentSize, setContentSize] = useState({ w: 0, h: 0 });
  /** Vykreslená velikost v CSS px (kvůli max-vh / max-vw) — musí sedět s <img>. */
  const [layoutCss, setLayoutCss] = useState({ w: 0, h: 0 });
  const [lineDraft, setLineDraft] = useState<{ x: number; y: number } | null>(null);
  const [shapeDraftEnd, setShapeDraftEnd] = useState<{ x: number; y: number } | null>(null);
  const [dragState, setDragState] = useState<{
    id: string;
    mode: "move" | "start" | "end";
    startX: number;
    startY: number;
  } | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [textPos, setTextPos] = useState<{ nx: number; ny: number } | null>(null);
  const [noteInput, setNoteInput] = useState("");
  const initialItemsRef = useRef<CustomerOverlayItem[]>([]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const baseImageRef = useRef<HTMLImageElement>(null);
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
      setContentSize({ w: 0, h: 0 });
      setLayoutCss({ w: 0, h: 0 });
      return;
    }
    const raw = annRemote as Record<string, unknown> | null | undefined;
    const key = `${docId}:${raw?.updatedAt ? JSON.stringify(raw.updatedAt) : "0"}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    const p = parseDocumentAnnotationDoc(raw);
    const initial = p?.items ?? [];
    if (process.env.NODE_ENV === "development") {
      console.log("loaded annotations", initial);
    }
    const snap = JSON.parse(JSON.stringify(initial)) as CustomerOverlayItem[];
    initialItemsRef.current = snap;
    undoStackRef.current = [snap];
    undoPtrRef.current = 0;
    setItems(initial);
    histBump();
  }, [open, docId, annRemote]);

  const embeddedItems = useMemo((): JobPhotoAnnotation[] => {
    if (!embeddedAnnotationData || fileType !== "image") return [];
    const refDim = readAnnotationPayloadReferenceSize(embeddedAnnotationData);
    const w = Math.max(1, contentSize.w || refDim?.width || 1);
    const h = Math.max(1, contentSize.h || refDim?.height || 1);
    return deserializeJobPhotoAnnotations(embeddedAnnotationData, w, h);
  }, [embeddedAnnotationData, fileType, contentSize.w, contentSize.h]);

  const syncLayoutCssFromImage = useCallback(() => {
    const el = baseImageRef.current;
    if (!el || fileType !== "image") return;
    const rw = Math.round(el.getBoundingClientRect().width);
    const rh = Math.round(el.getBoundingClientRect().height);
    if (rw > 0 && rh > 0) setLayoutCss({ w: rw, h: rh });
  }, [fileType]);

  useEffect(() => {
    if (!open || fileType !== "image") return;
    const el = baseImageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      syncLayoutCssFromImage();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, fileType, mediaUrl, syncLayoutCssFromImage]);

  useEffect(() => {
    if (!open || fileType !== "image" || contentSize.w < 1) return;
    requestAnimationFrame(() => syncLayoutCssFromImage());
  }, [open, fileType, contentSize.w, contentSize.h, zoom, pan, syncLayoutCssFromImage]);

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
    if (cw < 1 || ch < 1) return;
    const mid = midCanvasRef.current;
    const ov = overlayCanvasRef.current;
    if (!mid || !ov) return;
    mid.width = cw;
    mid.height = ch;
    ov.width = cw;
    ov.height = ch;
    const applyCssDisplay = (canvas: HTMLCanvasElement) => {
      if (fileType === "image" && layoutCss.w > 0 && layoutCss.h > 0) {
        canvas.style.width = `${layoutCss.w}px`;
        canvas.style.height = `${layoutCss.h}px`;
      } else {
        canvas.style.width = "";
        canvas.style.height = "";
      }
    };
    applyCssDisplay(mid);
    applyCssDisplay(ov);
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
    const selectedItem = items.find((it) => it.id === selectedId) ?? null;
    const editableSelectedId = canEditByPolicy(selectedItem, userId, actorRole, readOnly)
      ? selectedId
      : null;
    drawOverlayItems(
      octx,
      items,
      cw,
      ch,
      pageIdx,
      selectedId,
      editableSelectedId,
      hoveredId
    );
  }, [
    contentSize,
    layoutCss,
    embeddedItems,
    items,
    selectedId,
    userId,
    actorRole,
    readOnly,
    hoveredId,
    fileType,
    pdfPage,
  ]);

  useEffect(() => {
    if (!open) return;
    redrawMidAndOverlay();
  }, [open, redrawMidAndOverlay]);

  useEffect(() => {
    if (!open) return;
    if (process.env.NODE_ENV === "development") {
      console.log("annotations", items);
    }
  }, [items, open]);

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.log("active tool", tool);
    }
  }, [tool]);

  const getCanvasCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }, []);

  const isAdmin = useMemo(() => {
    const r = actorRole.toLowerCase();
    return (
      r === "owner" ||
      r === "superadmin" ||
      r === "admin" ||
      r === "manager" ||
      r === "accountant"
    );
  }, [actorRole]);

  const currentUser = useMemo(
    () => ({ uid: userId, role: actorRole.toLowerCase() }),
    [actorRole, userId]
  );

  const canEditAnnotation = useCallback(
    (it: CustomerOverlayItem | null | undefined): boolean => {
      return canEditByPolicy(it, userId, actorRole, readOnly);
    },
    [actorRole, readOnly, userId]
  );

  const canDeleteAnnotation = useCallback(
    (it: CustomerOverlayItem | null | undefined): boolean => {
      return canEditByPolicy(it, userId, actorRole, readOnly);
    },
    [actorRole, readOnly, userId]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (!open) return;
    const { x, y } = getCanvasCoords(e.clientX, e.clientY);
    const cw = contentSize.w;
    const ch = contentSize.h;
    const pageIdx = fileType === "pdf" ? pdfPage - 1 : 0;

    // Middle button always pans the scene.
    if (e.button === 1) {
      panDrag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (tool === "erase") {
      if (readOnly) return;
      const cur = itemsRef.current;
      const idx = [...cur]
        .map((it, i) => ({ it, i }))
        .reverse()
        .find(({ it }) => hitTestItem(x, y, it, cw, ch, pageIdx));
      if (idx && canDeleteAnnotation(idx.it)) {
        const next = cur.filter((_, j) => j !== idx.i);
        pushHistory(next);
        setSelectedId(null);
      }
      return;
    }

    if (tool === "line" || tool === "dimension") {
      if (readOnly) return;
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
          createdBy: userId,
          createdByRole: (isAdmin ? "admin" : "customer") as "admin" | "customer",
          role: (isAdmin ? "admin" : "customer") as "admin" | "customer",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          style: { lineWidth: 2, fillColor: null },
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
        } else if (tool === "dimension") {
          const raw = window.prompt("Text kóty", "2500 mm");
          pushHistory([
            ...itemsRef.current,
            {
              ...base,
              type: "dimension",
              x1: lineDraft.x,
              y1: lineDraft.y,
              x2: nx,
              y2: ny,
              text: (raw || "").trim() || "kóta",
              createdBy: userId,
              createdByRole: (isAdmin ? "admin" : "customer") as "admin" | "customer",
              role: isAdmin ? "admin" : "customer",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              style: { lineWidth: 2, fillColor: null },
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
              createdBy: userId,
              createdByRole: (isAdmin ? "admin" : "customer") as "admin" | "customer",
              role: isAdmin ? "admin" : "customer",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              style: { lineWidth: 18, fillColor: null },
            },
          ]);
        }
        setLineDraft(null);
      }
      return;
    }

    if (
      tool === "highlight" ||
      tool === "rectangle" ||
      tool === "square" ||
      tool === "circle"
    ) {
      if (readOnly) return;
      const nx = x / cw;
      const ny = y / ch;
      setLineDraft({ x: nx, y: ny });
      setShapeDraftEnd({ x: nx, y: ny });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (tool === "text") {
      if (readOnly) return;
      setTextPos({ nx: x / cw, ny: y / ch });
      setTextDraft("");
      return;
    }

    // Selection / drag in pan mode (left click). If nothing is hit, pan background.
    if (tool === "pan") {
      const cur = itemsRef.current;
      const hit = [...cur]
        .map((it, i) => ({ it, i }))
        .reverse()
        .find(({ it }) => hitTestItem(x, y, it, cw, ch, pageIdx));
      setSelectedId(hit ? hit.it.id : null);
      if (!hit) {
        panDrag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }
      if (!canEditAnnotation(hit.it)) return;
      if (
        hit.it.type === "line" ||
        hit.it.type === "dimension" ||
        hit.it.type === "highlight" ||
        hit.it.type === "rectangle" ||
        hit.it.type === "square" ||
        hit.it.type === "circle"
      ) {
        const sx = hit.it.x1 * cw;
        const sy = hit.it.y1 * ch;
        const ex = hit.it.x2 * cw;
        const ey = hit.it.y2 * ch;
        const ds = Math.hypot(x - sx, y - sy);
        const de = Math.hypot(x - ex, y - ey);
        setDragState({
          id: hit.it.id,
          mode: ds < 14 ? "start" : de < 14 ? "end" : "move",
          startX: x,
          startY: y,
        });
      } else {
        setDragState({ id: hit.it.id, mode: "move", startX: x, startY: y });
      }
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (tool === "draw") {
      if (readOnly) return;
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
    const { x, y } = getCanvasCoords(e.clientX, e.clientY);
    if (dragState) {
      const dx = (x - dragState.startX) / Math.max(1, contentSize.w);
      const dy = (y - dragState.startY) / Math.max(1, contentSize.h);
      const next = itemsRef.current.map((it) => {
        if (it.id !== dragState.id) return it;
        if (
          it.type === "line" ||
          it.type === "highlight" ||
          it.type === "dimension" ||
          it.type === "rectangle" ||
          it.type === "square" ||
          it.type === "circle"
        ) {
          if (dragState.mode === "start") {
            return { ...it, x1: it.x1 + dx, y1: it.y1 + dy };
          }
          if (dragState.mode === "end") {
            return { ...it, x2: it.x2 + dx, y2: it.y2 + dy };
          }
          return {
            ...it,
            x1: it.x1 + dx,
            y1: it.y1 + dy,
            x2: it.x2 + dx,
            y2: it.y2 + dy,
          };
        }
        if (it.type === "text") return { ...it, x: it.x + dx, y: it.y + dy };
        if (it.type === "draw") {
          return {
            ...it,
            points: it.points.map((p) => {
              const [px, py] = pointXY(p);
              return [px + dx, py + dy] as [number, number];
            }),
          };
        }
        return it;
      });
      setItems(next);
      itemsRef.current = next;
      console.log("annotations", next);
      setDragState({ ...dragState, startX: x, startY: y });
      return;
    }
    if (
      lineDraft &&
      shapeDraftEnd &&
      (tool === "highlight" ||
        tool === "rectangle" ||
        tool === "square" ||
        tool === "circle")
    ) {
      setShapeDraftEnd({ x: x / Math.max(1, contentSize.w), y: y / Math.max(1, contentSize.h) });
      const octx = overlayCanvasRef.current?.getContext("2d");
      if (octx) {
        redrawMidAndOverlay();
        const x1 = lineDraft.x * contentSize.w;
        const y1 = lineDraft.y * contentSize.h;
        const x2 = (x / Math.max(1, contentSize.w)) * contentSize.w;
        const y2 = (y / Math.max(1, contentSize.h)) * contentSize.h;
        octx.strokeStyle = colorHex(strokeColor);
        octx.lineWidth = 2;
        if (tool === "highlight") {
          octx.globalAlpha = 0.28;
          octx.lineWidth = 18;
          octx.lineCap = "round";
          octx.beginPath();
          octx.moveTo(x1, y1);
          octx.lineTo(x2, y2);
          octx.stroke();
          octx.globalAlpha = 1;
        } else if (tool === "circle") {
          const rx = Math.min(x1, x2);
          const ry = Math.min(y1, y2);
          const rw = Math.abs(x2 - x1);
          const rh = Math.abs(y2 - y1);
          const cx = rx + rw / 2;
          const cy = ry + rh / 2;
          const r = Math.max(1, Math.min(rw, rh) / 2);
          octx.beginPath();
          octx.arc(cx, cy, r, 0, Math.PI * 2);
          octx.stroke();
        } else {
          let ex = x2;
          let ey = y2;
          if (tool === "square") {
            const side = Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1));
            ex = x1 + Math.sign(x2 - x1 || 1) * side;
            ey = y1 + Math.sign(y2 - y1 || 1) * side;
          }
          octx.strokeRect(Math.min(x1, ex), Math.min(y1, ey), Math.abs(ex - x1), Math.abs(ey - y1));
        }
      }
      return;
    }
    if (!drawBuf.current || readOnly) {
      const pageIdx = fileType === "pdf" ? pdfPage - 1 : 0;
      const hit = [...itemsRef.current]
        .map((it, i) => ({ it, i }))
        .reverse()
        .find(({ it }) => hitTestItem(x, y, it, contentSize.w, contentSize.h, pageIdx));
      setHoveredId(hit ? hit.it.id : null);
      return;
    }
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
    if (dragState) {
      pushHistory(itemsRef.current);
      console.log("annotations", itemsRef.current);
      setDragState(null);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* */
      }
      return;
    }
    if (
      lineDraft &&
      shapeDraftEnd &&
      !readOnly &&
      (tool === "highlight" ||
        tool === "rectangle" ||
        tool === "square" ||
        tool === "circle")
    ) {
      const base = {
        id: newItemId(),
        color: strokeColor,
        page: fileType === "pdf" ? pdfPage - 1 : 0,
        notes: [] as ThreadNote[],
        createdBy: userId,
        createdByRole: (isAdmin ? "admin" : "customer") as "admin" | "customer",
        role: (isAdmin ? "admin" : "customer") as "admin" | "customer",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        style: {
          lineWidth: tool === "highlight" ? 18 : 2,
          fillColor: null,
        },
      };
      pushHistory([
        ...itemsRef.current,
        {
          ...base,
          type: tool as "highlight" | ShapeTool,
          x1: lineDraft.x,
          y1: lineDraft.y,
          x2: shapeDraftEnd.x,
          y2: shapeDraftEnd.y,
        },
      ]);
      setLineDraft(null);
      setShapeDraftEnd(null);
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
            createdBy: userId,
            createdByRole: (isAdmin ? "admin" : "customer") as "admin" | "customer",
            role: isAdmin ? "admin" : "customer",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            style: { lineWidth: 3, fillColor: null },
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
    const { x, y } = getCanvasCoords(e.clientX, e.clientY);
    const pageIdx = fileType === "pdf" ? pdfPage - 1 : 0;
    const hit = [...items]
      .map((it, i) => ({ it, i }))
      .reverse()
      .find(({ it }) => hitTestItem(x, y, it, contentSize.w, contentSize.h, pageIdx));
    setSelectedId(hit ? hit.it.id : null);
    console.log("selected", hit?.it ?? null);
    console.log("selected", hit?.it?.id ?? null);
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
      if (process.env.NODE_ENV === "development") {
        console.log("annotations before save", items);
        console.log(
          "draw annotations before normalize",
          items.filter((a) => a.type === "draw" || (a as { type?: string }).type === "freeDraw")
        );
      }
      const normalizeItemForSave = (it: CustomerOverlayItem, old?: CustomerOverlayItem) => {
        const now = Date.now();
        const createdByRole =
          (old as { createdByRole?: "admin" | "customer" } | undefined)?.createdByRole ||
          (it as { createdByRole?: "admin" | "customer" }).createdByRole ||
          old?.role ||
          it.role ||
          (isAdmin ? "admin" : "customer");
        return {
          ...it,
          createdBy: old?.createdBy || it.createdBy || userId,
          createdByRole,
          role: old?.role || it.role || createdByRole,
          createdAt: old?.createdAt || it.createdAt || now,
          updatedAt: now,
        } as CustomerOverlayItem;
      };
      const currentById = new Map(items.map((it) => [it.id, it]));
      const originalById = new Map(initialItemsRef.current.map((it) => [it.id, it]));
      const securedItems: CustomerOverlayItem[] = [];
      for (const [id, original] of originalById) {
        const current = currentById.get(id);
        if (!current) {
          if (isAdmin || canDeleteAnnotation(original)) continue;
          securedItems.push(original);
          continue;
        }
        if (isAdmin || canEditAnnotation(original)) {
          securedItems.push(normalizeItemForSave(current, original));
        } else {
          securedItems.push(original);
        }
      }
      for (const current of items) {
        if (originalById.has(current.id)) continue;
        if (!isAdmin && current.createdBy && current.createdBy !== userId) continue;
        securedItems.push(normalizeItemForSave(current));
      }
      const payload = serializePayload(securedItems);
      const normalizedFileId = String(mediaDocumentId ?? "").trim();
      const targetId = normalizedFileId || docId;
      const targetType: "image" | "pdf" = fileType;
      const photoId =
        storagePath.kind === "photos" && targetType === "image" && normalizedFileId
          ? normalizedFileId
          : undefined;
      const documentId =
        storagePath.kind === "folderImages" && normalizedFileId ? normalizedFileId : targetId;
      const row: DocumentAnnotationFirestoreDoc = {
        companyId,
        jobId,
        documentId,
        targetId,
        targetType,
        fileId: normalizedFileId || undefined,
        targetKind: storagePath.kind === "photos" ? "photos" : "folderImages",
        ...(storagePath.kind === "folderImages" && storagePath.folderId
          ? { folderId: storagePath.folderId, imageId: documentId }
          : {}),
        ...(photoId ? { photoId } : {}),
        mediaKind: fileType,
        type: "customer_overlay",
        data: payload,
        visibleFor: ["customer", "admin"],
        updatedBy: userId,
      };
      const payloadBeforeSanitize = {
        ...row,
        updatedAt: serverTimestamp(),
      };
      const sanitizedPayload = sanitizeFirestorePayload(payloadBeforeSanitize);
      if (process.env.NODE_ENV === "development") {
        const selectedLocal = itemsRef.current.find((x) => x.id === selectedId) ?? null;
        console.log("currentUser", currentUser);
        console.log("selectedAnnotation", selectedLocal);
        console.log("canEditAnnotation", canEditAnnotation(selectedLocal));
        console.log("annotation save target", {
          photoId,
          documentId,
          targetId,
          fileId: normalizedFileId || null,
          targetType,
        });
        console.log("annotation payload before sanitize", payloadBeforeSanitize);
        console.log("annotation payload after sanitize", sanitizedPayload);
      }
      await setDoc(annRef, sanitizedPayload, { merge: true });
      if (!isAdmin) {
        await createCustomerActivity(firestore, {
          organizationId: companyId,
          jobId,
          customerUserId: userId,
          customerId: null,
          type:
            fileType === "pdf"
              ? "customer_pdf_annotation"
              : "customer_image_annotation",
          title: "Anotace dokumentu",
          message: "Zákazník uložil anotaci do dokumentu.",
          createdBy: userId,
          createdByRole: "customer",
          isRead: false,
          targetType: "annotation",
          targetId: targetId,
          targetLink: `/portal/jobs/${jobId}`,
        });
      }
      initialItemsRef.current = JSON.parse(JSON.stringify(securedItems)) as CustomerOverlayItem[];
      itemsRef.current = securedItems;
      setItems(securedItems);
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
        createdBy: userId,
        createdByRole: (isAdmin ? "admin" : "customer") as "admin" | "customer",
        role: isAdmin ? "admin" : "customer",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        style: { lineWidth: 1, fillColor: null },
      },
    ]);
    setTextPos(null);
    setTextDraft("");
  };

  const addThreadNote = () => {
    if (!selectedId || !noteInput.trim()) return;
    const target = itemsRef.current.find((x) => x.id === selectedId);
    if (!target || !canEditAnnotation(target)) return;
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
    if (!isAdmin) {
      void createCustomerActivity(firestore, {
        organizationId: companyId,
        jobId,
        customerUserId: userId,
        customerId: null,
        type: "customer_note_added",
        title: "Poznámka v anotaci",
        message: "Zákazník přidal poznámku k anotaci.",
        createdBy: userId,
        createdByRole: "customer",
        isRead: false,
        targetType: "annotation",
        targetId: selectedId,
        targetLink: `/portal/jobs/${jobId}`,
      });
    }
    setNoteInput("");
  };

  const selected = items.find((x) => x.id === selectedId) ?? null;
  const selectedEditable = selected ? canEditAnnotation(selected) : false;

  const getCanvasCursor = (): string => {
    if (
      tool === "draw" ||
      tool === "line" ||
      tool === "dimension" ||
      tool === "highlight" ||
      tool === "rectangle" ||
      tool === "square" ||
      tool === "circle"
    ) {
      return "crosshair";
    }
    if (tool === "erase") return "cell";
    if (tool === "text") return "text";
    if (dragState) return "grabbing";
    if (tool === "pan") {
      if (selectedEditable) return "move";
      if (hoveredId) return "pointer";
      return "grab";
    }
    return "default";
  };

  if (!open) return null;

  const toolbarBtn = (t: Tool, icon: React.ReactNode, label: string) => (
    <Button
      type="button"
      size="sm"
      variant="default"
      className={cn(
        "h-9 gap-1 border-0 bg-orange-500 text-white transition-colors duration-150 hover:bg-gray-500 hover:text-white",
        tool === t && "bg-orange-600 text-white hover:bg-orange-600",
        readOnly && t !== "pan" && "pointer-events-none opacity-50"
      )}
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
          {toolbarBtn("dimension", <Ruler className="h-4 w-4" />, "Kóta")}
          {toolbarBtn("square", <Square className="h-4 w-4" />, "Čtverec")}
          {toolbarBtn("rectangle", <Square className="h-4 w-4" />, "Obdélník")}
          {toolbarBtn("circle", <Circle className="h-4 w-4" />, "Kruh")}
          {toolbarBtn("text", <Type className="h-4 w-4" />, "Text")}
          {toolbarBtn("highlight", <Highlighter className="h-4 w-4" />, "Zvýraznit")}
          {toolbarBtn("erase", <Eraser className="h-4 w-4" />, "Smazat")}
          {toolbarBtn("pan", <span className="text-xs">✥</span>, "Select")}
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
          variant="default"
          className="h-9 border-0 bg-orange-500 text-white transition-colors duration-150 hover:bg-gray-500 hover:text-white disabled:bg-orange-700/70 disabled:text-white"
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
                  ref={baseImageRef}
                  src={mediaUrl}
                  alt=""
                  className="absolute left-0 top-0 block max-h-[85vh] max-w-[90vw] object-contain"
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    const nw = el.naturalWidth;
                    const nh = el.naturalHeight;
                    if (nw > 0 && nh > 0) {
                      setContentSize({ w: nw, h: nh });
                    }
                    requestAnimationFrame(() => syncLayoutCssFromImage());
                  }}
                />
              ) : null}
              <canvas
                ref={baseCanvasRef}
                className={cn(
                  "block max-h-[85vh] max-w-[90vw]",
                  fileType === "image" && "pointer-events-none opacity-0"
                )}
              />
              <canvas
                ref={midCanvasRef}
                className="pointer-events-none absolute left-0 top-0 max-h-[85vh] max-w-[90vw] object-contain"
              />
              <canvas
                ref={overlayCanvasRef}
                className="absolute left-0 top-0 max-h-[85vh] max-w-[90vw] touch-none object-contain"
                style={{
                  cursor: getCanvasCursor(),
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
          {adminNote?.trim() ? (
            <div className="border-b border-white/10 p-3">
              <p className="text-xs font-medium text-white/85">Poznámka od administrátora</p>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-snug text-white/80">
                {adminNote.trim()}
              </p>
            </div>
          ) : null}
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
                {!selectedEditable ? (
                  <p className="text-xs text-orange-300">Tuto anotaci nelze upravit.</p>
                ) : null}
                {selected.type === "dimension" && canEditAnnotation(selected) ? (
                  <div className="space-y-1">
                    <Input
                      value={selected.text}
                      onChange={(e) => {
                        const v = e.target.value.slice(0, 120);
                        const next = itemsRef.current.map((it) =>
                          it.id === selected.id && it.type === "dimension"
                            ? { ...it, text: v }
                            : it
                        );
                        setItems(next);
                        itemsRef.current = next;
                      }}
                      onBlur={() => pushHistory(itemsRef.current)}
                      className="border-white/20 bg-white/10 text-white"
                      placeholder="Text kóty"
                    />
                  </div>
                ) : null}
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
