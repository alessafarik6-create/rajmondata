"use client";

import React, { useMemo } from "react";
import type { Firestore } from "firebase/firestore";
import { collection, limit, orderBy, query } from "firebase/firestore";
import { useCollection, useMemoFirebase } from "@/firebase";
import { Loader2 } from "lucide-react";

type Props = {
  firestore: Firestore | null;
  companyId: string;
  kind: "document" | "invoice";
  entityId: string;
};

function formatSentAt(raw: unknown): string {
  try {
    const t = raw as { toDate?: () => Date };
    if (t && typeof t.toDate === "function") return t.toDate().toLocaleString("cs-CZ");
  } catch {
    /* ignore */
  }
  return "";
}

export function DocumentEmailOutboundHistory({
  firestore,
  companyId,
  kind,
  entityId,
}: Props) {
  const q = useMemoFirebase(() => {
    if (!firestore || !companyId || !entityId) return null;
    const seg = kind === "document" ? "documents" : "invoices";
    return query(
      collection(firestore, "companies", companyId, seg, entityId, "emailOutboundHistory"),
      orderBy("sentAt", "desc"),
      limit(20)
    );
  }, [firestore, companyId, kind, entityId]);

  const { data: rows, isLoading } = useCollection(q);

  const items = useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    return list.map((r) => {
      const rec = r as Record<string, unknown> & { id: string };
      return {
        id: rec.id,
        subject: String(rec.subject ?? "").trim(),
        to: String(rec.to ?? rec.recipientsTo ?? "").trim(),
        sentAt: rec.sentAt,
        attachments: Array.isArray(rec.attachmentFilenames)
          ? (rec.attachmentFilenames as string[]).filter(Boolean)
          : [],
      };
    });
  }, [rows]);

  if (!firestore || !companyId || !entityId) return null;

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50/90 p-3 text-[11px] text-gray-800">
      <div className="font-semibold text-gray-900">Historie odeslání e-mailem</div>
      {isLoading ? (
        <div className="mt-2 flex items-center gap-2 text-gray-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Načítám…
        </div>
      ) : items.length === 0 ? (
        <p className="mt-1.5 text-gray-600">Zatím žádné úspěšné odeslání z tohoto místa.</p>
      ) : (
        <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto pr-1">
          {items.map((it) => (
            <li
              key={it.id}
              className="rounded border border-gray-200 bg-white px-2 py-1.5 leading-snug"
            >
              <div className="font-medium text-gray-950">{it.subject || "(bez předmětu)"}</div>
              <div className="text-[10px] text-gray-600">
                {formatSentAt(it.sentAt)}
                {it.to ? ` → ${it.to}` : null}
              </div>
              {it.attachments.length ? (
                <div className="mt-0.5 text-[10px] text-gray-500">
                  Přílohy: {it.attachments.join(", ")}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
