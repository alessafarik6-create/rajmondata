"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, limit, orderBy, query } from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase";
import { DashboardCompactCard } from "@/components/portal/dashboard-compact-card";
import { Car, Factory, FileText, Package } from "lucide-react";
import type { InventoryItemRow, InventoryMovementRow } from "@/lib/inventory-types";
import type { ProductionRecordRow, ProductionStatus } from "@/lib/production-types";
import { PRODUCTION_STATUS_LABELS } from "@/lib/production-types";
import { formatInquiryOfferPrice } from "@/lib/inquiry-offer-history";
import { safeTime } from "@/lib/date-safe";
import { formatMessageDateFromValue } from "@/lib/date-safe";

function movementSign(type: string, qty: number): string {
  const t = type.toLowerCase();
  if (t === "in" || t === "remainder_created") return `+ ${qty}`;
  if (t.startsWith("out") || t === "partial_out") return `- ${qty}`;
  return `${qty}`;
}

export function DashboardWarehouseCompact({ companyId }: { companyId: string }) {
  const firestore = useFirestore();
  const itemsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(collection(firestore, "companies", companyId, "inventoryItems"), limit(800));
  }, [firestore, companyId]);
  const movesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "inventoryMovements"),
      orderBy("date", "desc"),
      limit(3)
    );
  }, [firestore, companyId]);

  const { data: itemsRaw, isLoading: itemsLoading } = useCollection(itemsQuery);
  const { data: movesRaw, isLoading: movesLoading } = useCollection(movesQuery);

  const stats = useMemo(() => {
    const items = (itemsRaw ?? []) as InventoryItemRow[];
    const active = items.filter((i) => !i.isDeleted);
    const zeroQty = active.filter((i) => Number(i.quantity ?? 0) <= 0).length;
    let value = 0;
    for (const i of active) {
      const p = Number(i.unitPrice ?? 0);
      if (p > 0) value += p * Number(i.quantity ?? 0);
    }
    return { count: active.length, zeroQty, value };
  }, [itemsRaw]);

  const moves = (movesRaw ?? []) as InventoryMovementRow[];
  const loading = itemsLoading || movesLoading;

  return (
    <DashboardCompactCard
      title="Sklad"
      icon={<Package className="h-4 w-4 text-slate-600" />}
      accentClass="border-l-slate-500"
      href="/portal/sklad"
      footerLabel="Otevřít sklad"
    >
      {loading ? (
        <p className="text-xs text-muted-foreground">Načítání…</p>
      ) : (
        <div className="space-y-2 text-xs">
          <div className="flex flex-wrap gap-x-3 text-muted-foreground">
            <span>
              Položek: <strong className="text-foreground">{stats.count}</strong>
            </span>
            {stats.zeroQty > 0 ? (
              <span>
                Nulové: <strong className="text-foreground">{stats.zeroQty}</strong>
              </span>
            ) : null}
          </div>
          {stats.value > 0 ? (
            <p className="text-muted-foreground">
              Odhad hodnoty:{" "}
              <strong className="text-foreground">
                {Math.round(stats.value).toLocaleString("cs-CZ")} Kč
              </strong>
            </p>
          ) : null}
          {moves.length > 0 ? (
            <>
              <p className="text-[11px] font-medium text-foreground">Poslední pohyby</p>
              <ul className="space-y-1">
                {moves.map((m) => (
                  <li key={m.id} className="truncate rounded border border-border/50 px-2 py-1">
                    {movementSign(m.type, m.quantity)} {m.unit} {m.itemName}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted-foreground">Zatím bez pohybů.</p>
          )}
        </div>
      )}
    </DashboardCompactCard>
  );
}

export function DashboardProductionCompact({ companyId }: { companyId: string }) {
  const firestore = useFirestore();
  const prodQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(collection(firestore, "companies", companyId, "production"), limit(120));
  }, [firestore, companyId]);
  const { data: raw, isLoading } = useCollection(prodQuery);

  const { active, waiting, doneToday, latest } = useMemo(() => {
    const rows = (raw ?? []) as ProductionRecordRow[];
    const today = new Date().toISOString().slice(0, 10);
    let activeN = 0;
    let waitN = 0;
    let doneTodayN = 0;
    const sorted = [...rows].sort(
      (a, b) => safeTime(b.updatedAt ?? b.createdAt) - safeTime(a.updatedAt ?? a.createdAt)
    );
    for (const r of rows) {
      const st = r.status as ProductionStatus;
      if (st === "in_progress") activeN += 1;
      else if (st === "new" || st === "ready") waitN += 1;
      else if (st === "done") {
        const d = String(r.updatedAt ?? r.createdAt ?? "");
        if (d.includes(today)) doneTodayN += 1;
      }
    }
    return {
      active: activeN,
      waiting: waitN,
      doneToday: doneTodayN,
      latest: sorted.slice(0, 3),
    };
  }, [raw]);

  return (
    <DashboardCompactCard
      title="Výroba"
      icon={<Factory className="h-4 w-4 text-slate-600" />}
      accentClass="border-l-slate-600"
      href="/portal/vyroba"
      footerLabel="Otevřít výrobu"
    >
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Načítání…</p>
      ) : (
        <div className="space-y-2 text-xs">
          <div className="flex flex-wrap gap-x-3 text-muted-foreground">
            <span>
              Aktivní: <strong className="text-foreground">{active}</strong>
            </span>
            <span>
              Čeká: <strong className="text-foreground">{waiting}</strong>
            </span>
            <span>
              Hotovo dnes: <strong className="text-foreground">{doneToday}</strong>
            </span>
          </div>
          <ul className="space-y-1">
            {latest.map((p) => (
              <li key={p.id} className="truncate rounded border border-border/50 px-2 py-1">
                {p.title || p.jobName || "Výroba"}{" "}
                <span className="text-muted-foreground">
                  · {PRODUCTION_STATUS_LABELS[p.status] ?? p.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DashboardCompactCard>
  );
}

type FleetDash = {
  stats?: { total?: number; online?: number; moving?: number; idle?: number; offline?: number };
  vehicles?: { id: string; name?: string; licensePlate?: string }[];
  positions?: { vehicleId: string; movementStatus?: string; locationLabel?: string }[];
  gpsConnected?: boolean;
};

export function DashboardFleetCompact({
  companyId,
  fleetConnected,
}: {
  companyId: string;
  fleetConnected: boolean;
}) {
  const firestore = useFirestore();
  const vehiclesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(collection(firestore, "companies", companyId, "fleet_vehicles"), limit(50));
  }, [firestore, companyId]);
  const { data: vehiclesRaw } = useCollection(vehiclesQuery);
  const vehicleCount = (vehiclesRaw ?? []).length;

  const [dash, setDash] = useState<FleetDash | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!companyId || !fleetConnected) return;
    let cancelled = false;
    setLoading(true);
    void fetch(`/api/company/fleet/dashboard?companyId=${encodeURIComponent(companyId)}`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && j?.ok) setDash(j as FleetDash);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, fleetConnected]);

  const recent = useMemo(() => {
    const pos = dash?.positions ?? [];
    const byId = new Map<string, { label: string; status: string }>();
    for (const p of pos) {
      const v = dash?.vehicles?.find((x) => x.id === p.vehicleId);
      byId.set(p.vehicleId, {
        label: v?.name || v?.licensePlate || p.vehicleId,
        status: String(p.movementStatus ?? ""),
      });
    }
    return [...byId.entries()].slice(0, 3).map(([id, v]) => ({ id, ...v }));
  }, [dash]);

  return (
    <DashboardCompactCard
      title="Vozový park"
      icon={<Car className="h-4 w-4 text-sky-700" />}
      accentClass="border-l-sky-600"
      href="/portal/fleet"
      footerLabel="Otevřít vozový park"
    >
      {!fleetConnected ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>GPS monitoring není připojen.</p>
          {vehicleCount > 0 ? (
            <p>
              Evidovaných vozidel:{" "}
              <strong className="text-foreground">{vehicleCount}</strong>
            </p>
          ) : null}
        </div>
      ) : loading && !dash ? (
        <p className="text-xs text-muted-foreground">Načítání GPS…</p>
      ) : (
        <div className="space-y-2 text-xs">
          <div className="flex flex-wrap gap-x-2 text-muted-foreground">
            <span>
              Online: <strong className="text-foreground">{dash?.stats?.online ?? 0}</strong>
            </span>
            <span>
              V pohybu: <strong className="text-foreground">{dash?.stats?.moving ?? 0}</strong>
            </span>
            <span>
              Stojí: <strong className="text-foreground">{dash?.stats?.idle ?? 0}</strong>
            </span>
            <span>
              Offline: <strong className="text-foreground">{dash?.stats?.offline ?? 0}</strong>
            </span>
          </div>
          <ul className="space-y-1">
            {recent.map((v) => (
              <li key={v.id} className="truncate rounded border border-border/50 px-2 py-1">
                {v.label}{" "}
                <span className="text-muted-foreground">· {v.status || "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DashboardCompactCard>
  );
}

export function DashboardOffersCompact({ companyId }: { companyId: string }) {
  const firestore = useFirestore();
  const offersQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "inquiry_offers"),
      limit(200)
    );
  }, [firestore, companyId]);
  const { data: raw, isLoading } = useCollection(offersQuery);

  const stats = useMemo(() => {
    type OfferRow = {
      id: string;
      status?: string;
      subject?: string;
      customerName?: string | null;
      priceGross?: number | null;
      sentAt?: unknown;
      createdAt?: unknown;
    };
    const rows = (raw ?? []).map((row) => {
      const r = row as Record<string, unknown> & { id?: string };
      return {
        id: String(r.id ?? ""),
        status: String(r.status ?? "draft"),
        subject: String(r.subject ?? ""),
        customerName: r.customerName as string | null | undefined,
        priceGross: r.priceGross as number | null | undefined,
        sentAt: r.sentAt,
        createdAt: r.createdAt,
      } satisfies OfferRow;
    });
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    let drafts = 0;
    let sentMonth = 0;
    const sorted = [...rows].sort(
      (a, b) => safeTime(b.sentAt ?? b.createdAt) - safeTime(a.sentAt ?? a.createdAt)
    );
    for (const o of rows) {
      if (o.status === "draft") drafts += 1;
      if (o.status === "sent") {
        const ms = safeTime(o.sentAt ?? o.createdAt);
        if (ms) {
          const d = new Date(ms);
          if (d.getMonth() === month && d.getFullYear() === year) sentMonth += 1;
        }
      }
    }
    return { drafts, sentMonth, latest: sorted.slice(0, 3) };
  }, [raw]);

  return (
    <DashboardCompactCard
      title="Nabídky"
      icon={<FileText className="h-4 w-4 text-blue-600" />}
      accentClass="border-l-blue-500"
      href="/portal/offers"
      footerLabel="Otevřít nabídky"
    >
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Načítání…</p>
      ) : (
        <div className="space-y-2 text-xs">
          <p className="text-muted-foreground">
            Koncepty: <strong className="text-foreground">{stats.drafts}</strong>
            {" · "}
            Odeslané tento měsíc:{" "}
            <strong className="text-foreground">{stats.sentMonth}</strong>
          </p>
          <ul className="space-y-1">
            {stats.latest.map((o) => (
              <li key={o.id} className="truncate rounded border border-border/50 px-2 py-1">
                {o.customerName || o.subject || "Nabídka"}{" "}
                <span className="text-muted-foreground">
                  · {o.status === "sent" ? "odesláno" : "koncept"}
                  {o.priceGross != null ? ` · ${formatInquiryOfferPrice(o.priceGross)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DashboardCompactCard>
  );
}

export type PendingDocPreview = {
  id: string;
  fileName?: string | null;
  fileType?: string | null;
  createdAt?: unknown;
  amountGrossCZK?: number | null;
  castkaCZK?: number | null;
};

export function DashboardPendingDocumentsCompact({
  pendingDocuments,
}: {
  pendingDocuments: PendingDocPreview[];
}) {
  const top = pendingDocuments.slice(0, 3);
  if (pendingDocuments.length === 0) return null;

  return (
    <DashboardCompactCard
      title="Doklady k zařazení"
      icon={<FileText className="h-4 w-4 text-amber-700" />}
      accentClass="border-l-amber-600"
      href="/portal/documents"
      footerLabel="Zařadit doklady"
    >
      <div className="space-y-2 text-xs">
        <p className="text-muted-foreground">
          Čeká: <strong className="text-foreground">{pendingDocuments.length}</strong>
        </p>
        <ul className="space-y-1">
          {top.map((d) => {
            const amt = Number(d.amountGrossCZK ?? d.castkaCZK ?? 0);
            const when = formatMessageDateFromValue(d.createdAt);
            return (
              <li key={d.id}>
                <Link
                  href="/portal/documents"
                  className="block rounded border border-border/50 px-2 py-1 hover:bg-muted/30"
                >
                  <span className="font-medium truncate block">
                    {d.fileName || d.fileType || "Doklad"}
                  </span>
                  <span className="text-[11px] text-muted-foreground flex justify-between gap-2">
                    <span>{d.fileType || "—"}</span>
                    <span>
                      {amt > 0 ? `${amt.toLocaleString("cs-CZ")} Kč` : "—"} · {when}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </DashboardCompactCard>
  );
}

const IMPORTANT_ACTIVITY_TYPES = new Set([
  "customer_media_approval_approved",
  "customer_document_comment",
  "customer_note_added",
  "customer_chat_message",
  "customer_media_review_comment",
]);

export function filterImportantDashboardActivities<
  T extends { type?: string; title?: string; message?: string }
>(rows: T[]): T[] {
  return rows.filter((r) => {
    const t = String(r.type ?? "");
    if (IMPORTANT_ACTIVITY_TYPES.has(t)) return true;
    const title = `${r.title ?? ""} ${r.message ?? ""}`.toLowerCase();
    if (title.includes("schválen") || title.includes("zakázk")) return true;
    if (title.includes("komentář") || title.includes("soubor") || title.includes("e-mail")) return true;
    return false;
  });
}
