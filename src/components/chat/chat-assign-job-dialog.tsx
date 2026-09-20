"use client";

import React, { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { collection, limit, query } from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase";
import { Loader2 } from "lucide-react";

type JobRow = { id: string; name?: string; orderNumber?: string; customerName?: string };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  onAssign: (jobId: string, jobLabel: string) => void | Promise<void>;
  assigning?: boolean;
};

export function ChatAssignJobDialog({
  open,
  onOpenChange,
  companyId,
  onAssign,
  assigning,
}: Props) {
  const firestore = useFirestore();
  const [search, setSearch] = useState("");
  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !open) return null;
    return query(collection(firestore, "companies", companyId, "jobs"), limit(250));
  }, [firestore, companyId, open]);
  const { data: raw, isLoading } = useCollection(jobsQuery);

  const jobs = useMemo(() => {
    const rows = (raw ?? []) as Record<string, unknown>[];
    return rows.map((r) => {
      const id = String(r.id ?? "");
      const name = String(r.title ?? r.name ?? "").trim();
      const orderNumber = String(r.orderNumber ?? r.jobNumber ?? "").trim();
      const customerName = String(r.customerName ?? r.clientName ?? "").trim();
      return { id, name, orderNumber, customerName };
    });
  }, [raw]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return jobs.slice(0, 40);
    return jobs
      .filter((j) => {
        const hay = `${j.id} ${j.orderNumber} ${j.name} ${j.customerName}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 40);
  }, [jobs, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Přiřadit k zakázce</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Hledat číslo, zákazníka, název…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-64 overflow-y-auto space-y-1 text-sm">
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">Žádná zakázka.</p>
          ) : (
            filtered.map((j) => {
              const label = j.name || j.customerName || j.id;
              return (
                <button
                  key={j.id}
                  type="button"
                  className="w-full rounded-md border border-border/60 px-3 py-2 text-left hover:bg-muted/50"
                  disabled={assigning}
                  onClick={() => void onAssign(j.id, label)}
                >
                  <span className="font-medium block truncate">{label}</span>
                  <span className="text-xs text-muted-foreground">
                    {[j.orderNumber, j.customerName].filter(Boolean).join(" · ")}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Zavřít
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
