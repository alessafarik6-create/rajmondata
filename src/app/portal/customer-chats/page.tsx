"use client";

import React from "react";
import {
  addDoc,
  collection,
  doc,
  documentId,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { useCollection, useCompany, useFirestore, useMemoFirebase } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSearchParams } from "next/navigation";
import { deriveCustomerDisplayNameFromCustomerDoc } from "@/lib/customer-address-display";
import { deriveCustomerDisplayNameFromJob } from "@/lib/job-customer-client";
import { cn } from "@/lib/utils";

type ConversationRow = {
  id: string;
  customerId?: string | null;
  customerUserId?: string | null;
  jobId?: string | null;
  lastMessagePreview?: string | null;
};

type JobMeta = { name: string; customerName: string };

function chunkIds<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function resolveConversationTitle(
  c: ConversationRow,
  customerNames: Record<string, string>,
  jobMeta: Record<string, JobMeta>
): string {
  const cid = String(c.customerId ?? "").trim();
  if (cid) {
    const n = customerNames[cid];
    if (n) return n;
    return "Neznámý zákazník";
  }
  const jid = String(c.jobId ?? "").trim();
  if (jid) {
    const jm = jobMeta[jid];
    const fromJob = deriveCustomerDisplayNameFromJob({
      customerName: jm?.customerName ?? null,
    });
    if (fromJob) return fromJob;
  }
  return "Neznámý zákazník";
}

function jobLine(c: ConversationRow, jobMeta: Record<string, JobMeta>): string | null {
  const jid = String(c.jobId ?? "").trim();
  if (!jid) return null;
  const name = String(jobMeta[jid]?.name ?? "").trim();
  return name || null;
}

export default function CustomerChatsPage() {
  const firestore = useFirestore();
  const { companyId } = useCompany();
  const searchParams = useSearchParams();
  const conversationIdFromUrl = (searchParams.get("conversationId") || "").trim();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [text, setText] = React.useState("");
  const [customerNames, setCustomerNames] = React.useState<Record<string, string>>({});
  const [jobMeta, setJobMeta] = React.useState<Record<string, JobMeta>>({});
  const [metaLoading, setMetaLoading] = React.useState(false);

  const convRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? query(collection(firestore, "companies", companyId, "customer_conversations"), orderBy("lastMessageAt", "desc"))
        : null,
    [firestore, companyId]
  );
  const { data: conversations } = useCollection(convRef);

  const relatedIdsKey = React.useMemo(() => {
    const list = (conversations ?? []) as ConversationRow[];
    const cids = new Set<string>();
    const jids = new Set<string>();
    for (const row of list) {
      const cid = String(row.customerId ?? "").trim();
      if (cid) cids.add(cid);
      const jid = String(row.jobId ?? "").trim();
      if (jid) jids.add(jid);
    }
    return `${[...cids].sort().join("\u0001")}\u0000${[...jids].sort().join("\u0001")}`;
  }, [conversations]);

  React.useEffect(() => {
    if (!firestore || !companyId) {
      setCustomerNames({});
      setJobMeta({});
      setMetaLoading(false);
      return;
    }

    const list = (conversations ?? []) as ConversationRow[];
    const customerIds = [...new Set(list.map((r) => String(r.customerId ?? "").trim()).filter(Boolean))];
    const jobIds = [...new Set(list.map((r) => String(r.jobId ?? "").trim()).filter(Boolean))];

    if (customerIds.length === 0 && jobIds.length === 0) {
      setCustomerNames({});
      setJobMeta({});
      setMetaLoading(false);
      return;
    }

    let cancelled = false;
    setMetaLoading(true);

    (async () => {
      const customers: Record<string, string> = {};
      const jobs: Record<string, JobMeta> = {};

      try {
        const customersCol = collection(firestore, "companies", companyId, "customers");
        for (const part of chunkIds(customerIds, 10)) {
          const qy = query(customersCol, where(documentId(), "in", part));
          const snap = await getDocs(qy);
          snap.forEach((d) => {
            const label = deriveCustomerDisplayNameFromCustomerDoc(d.data());
            if (label) customers[d.id] = label;
          });
        }

        const jobsCol = collection(firestore, "companies", companyId, "jobs");
        for (const part of chunkIds(jobIds, 10)) {
          const qy = query(jobsCol, where(documentId(), "in", part));
          const snap = await getDocs(qy);
          snap.forEach((d) => {
            const data = d.data() as Record<string, unknown>;
            jobs[d.id] = {
              name: String(data.name ?? "").trim(),
              customerName: String(data.customerName ?? "").trim(),
            };
          });
        }
      } catch (e) {
        console.error("[CustomerChatsPage] load customer/job meta", e);
      }

      if (!cancelled) {
        setCustomerNames(customers);
        setJobMeta(jobs);
        setMetaLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // relatedIdsKey = množiny customerId/jobId; `conversations` jen pro aktuální snapshot při změně těchto množin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, companyId, relatedIdsKey]);

  React.useEffect(() => {
    if (!conversationIdFromUrl) return;
    setSelectedId(conversationIdFromUrl);
  }, [conversationIdFromUrl]);

  const selected = React.useMemo(() => {
    const list = (conversations ?? []) as ConversationRow[];
    if (!list.length) return null;
    if (selectedId) return list.find((c) => c.id === selectedId) ?? list[0];
    if (conversationIdFromUrl) return list.find((c) => c.id === conversationIdFromUrl) ?? list[0];
    return list[0];
  }, [conversations, selectedId, conversationIdFromUrl]);

  const messagesRef = useMemoFirebase(
    () =>
      firestore && companyId && selected
        ? query(
            collection(firestore, "companies", companyId, "customer_conversations", selected.id, "messages"),
            orderBy("createdAt", "asc")
          )
        : null,
    [firestore, companyId, selected?.id]
  );
  const { data: messages } = useCollection(messagesRef);

  const sendAdminReply = async () => {
    if (!firestore || !companyId || !selected || !text.trim()) return;
    await addDoc(collection(firestore, "companies", companyId, "customer_conversations", selected.id, "messages"), {
      senderId: "admin",
      senderRole: "admin",
      text: text.trim(),
      createdAt: serverTimestamp(),
      isRead: false,
      attachments: [],
    });
    await setDoc(
      doc(firestore, "companies", companyId, "customer_conversations", selected.id),
      {
        lastMessageAt: serverTimestamp(),
        lastMessagePreview: text.trim().slice(0, 180),
        unreadForCustomerCount: increment(1),
        unreadForAdminCount: 0,
      },
      { merge: true }
    );
    setText("");
  };

  const convList = (conversations ?? []) as ConversationRow[];

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[320px,1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Zákaznické chaty</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {convList.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím nejsou žádné konverzace.</p>
          ) : null}
          {convList.map((c) => {
            const title = metaLoading ? "Načítání…" : resolveConversationTitle(c, customerNames, jobMeta);
            const jobName = metaLoading ? null : jobLine(c, jobMeta);
            const preview = String(c.lastMessagePreview ?? "").trim();

            return (
              <button
                key={c.id}
                type="button"
                className={cn(
                  "w-full rounded-lg border p-3 text-left transition-colors",
                  selected?.id === c.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                )}
                onClick={() => setSelectedId(c.id)}
              >
                <div className="font-semibold text-foreground leading-snug">{title}</div>
                {jobName ? (
                  <div className="mt-0.5 text-sm text-muted-foreground">Zakázka: {jobName}</div>
                ) : null}
                {preview ? (
                  <div className="mt-1 text-sm text-muted-foreground/90 truncate" title={preview}>
                    {preview}
                  </div>
                ) : null}
              </button>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Konverzace</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Konverzace nebyla nalezena.</p>
          ) : null}
          <div className="max-h-[60vh] space-y-2 overflow-auto rounded border p-2">
            {!selected ? null : (messages ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Chat zatím neobsahuje žádné zprávy.</p>
            ) : (
              (messages ?? []).map((m) => (
                <div
                  key={m.id}
                  className={`rounded px-3 py-2 text-sm ${(m as { senderRole?: string }).senderRole === "admin" ? "ml-auto max-w-[80%] bg-primary/10" : "mr-auto max-w-[80%] bg-muted"}`}
                >
                  {String((m as { text?: string }).text ?? "")}
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Odpověď zákazníkovi…" />
            <Button type="button" onClick={() => void sendAdminReply()} disabled={!text.trim() || !selected}>
              Odeslat
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
