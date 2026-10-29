"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFirestore, useMemoFirebase, useUser, useCollection } from "@/firebase";
import { collection } from "firebase/firestore";
import { cn } from "@/lib/utils";
import type { ChatWorkIntentProposal } from "@/lib/chat/chat-work-intent-types";
import type { ChatWorkIntentApplyDraftsByProposal } from "@/lib/chat/chat-work-intent-apply-types";
import {
  filterEmployeesForAssignment,
  formatEmployeeDisplayName,
} from "@/lib/employee-active";

export type BulkRowState = ChatWorkIntentApplyDraftsByProposal[string] & {
  proposalId: string;
  dirtyCustomer?: boolean;
  dirtyEmployees?: boolean;
  dirtyNote?: boolean;
};

function defaultTitle(p: ChatWorkIntentProposal, idx: number): string {
  return (
    String(p.jobTitle ?? "").trim() ||
    (p.detectedType === "reservation" ? `Rezervace ${idx + 1}` : `Zakázka ${idx + 1}`)
  );
}

function proposalToRow(p: ChatWorkIntentProposal, idx: number): BulkRowState {
  return {
    proposalId: p.proposalId,
    jobTitle: defaultTitle(p, idx),
    scheduledDate: p.scheduledDate ?? "",
    scheduledEndDate: p.scheduledEndDate ?? "",
    customerId: p.customerMatch?.customerId ?? null,
    customerName: p.customerName ?? p.companyName ?? "",
    email: p.email ?? "",
    phone: p.phone ?? "",
    address: p.address ?? "",
    createNewCustomer: false,
    note: p.description ?? p.sourceQuote ?? "",
    assignedEmployeeIds: [],
    notifyEmployee: false,
  };
}

export function ChatWorkIntentBulkDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  proposals: ChatWorkIntentProposal[];
  selectedIds: Set<string>;
  applyMode: "jobs" | "meetings" | "tasks";
  applying: boolean;
  applyError: string | null;
  applyResults: Array<{
    proposalId: string;
    ok: boolean;
    error?: string;
    jobId?: string;
    jobName?: string;
  }> | null;
  onSubmit: (drafts: ChatWorkIntentApplyDraftsByProposal, selectedIds: string[]) => void;
  onRetryFailed?: () => void;
}) {
  const { user } = useUser();
  const firestore = useFirestore();
  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !props.companyId) return null;
    return collection(firestore, "companies", props.companyId, "employees");
  }, [firestore, props.companyId]);
  const { data: employeeRows = [] } = useCollection<Record<string, unknown> & { id: string }>(
    employeesQuery
  );
  const employees = useMemo(
    () => filterEmployeesForAssignment(employeeRows ?? []),
    [employeeRows]
  );

  const selectedProposals = useMemo(
    () => props.proposals.filter((p) => props.selectedIds.has(p.proposalId)),
    [props.proposals, props.selectedIds]
  );

  const [rows, setRows] = useState<BulkRowState[]>([]);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerHits, setCustomerHits] = useState<Array<{ id: string; label: string }>>([]);
  const [activeCustomerProposalId, setActiveCustomerProposalId] = useState<string | null>(null);
  const [bulkEmpIds, setBulkEmpIds] = useState<string[]>([]);
  const [bulkCustomerId, setBulkCustomerId] = useState<string>("");
  const [bulkNote, setBulkNote] = useState("");
  const [bulkNotify, setBulkNotify] = useState(true);
  const [overwriteManual, setOverwriteManual] = useState(false);
  const [empFilter, setEmpFilter] = useState("");

  useEffect(() => {
    if (!props.open) return;
    setRows(
      selectedProposals.map((p, idx) =>
        proposalToRow(p, props.proposals.findIndex((x) => x.proposalId === p.proposalId))
      )
    );
    setValidationErrors({});
  }, [props.open, selectedProposals, props.proposals]);

  const searchCustomers = useCallback(
    async (q: string) => {
      if (!user || q.trim().length < 1) {
        setCustomerHits([]);
        return;
      }
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/chat/customers-search?q=${encodeURIComponent(q.trim())}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = (await res.json()) as { ok?: boolean; customers?: Array<{ id: string; label: string }> };
      setCustomerHits(data.ok ? data.customers ?? [] : []);
    },
    [user]
  );

  useEffect(() => {
    const t = setTimeout(() => void searchCustomers(customerQuery), 280);
    return () => clearTimeout(t);
  }, [customerQuery, searchCustomers]);

  const updateRow = (proposalId: string, patch: Partial<BulkRowState>) => {
    setRows((list) =>
      list.map((r) => (r.proposalId === proposalId ? { ...r, ...patch } : r))
    );
  };

  const applyBulkToAll = () => {
    setRows((list) =>
      list.map((r) => {
        const next = { ...r };
        if (bulkEmpIds.length && (overwriteManual || !r.dirtyEmployees)) {
          next.assignedEmployeeIds = [...bulkEmpIds];
          next.notifyEmployee = bulkNotify;
        }
        if (bulkCustomerId && (overwriteManual || !r.dirtyCustomer)) {
          next.customerId = bulkCustomerId;
          next.createNewCustomer = false;
        }
        if (bulkNote.trim() && (overwriteManual || !r.dirtyNote)) {
          next.note = bulkNote.trim();
        }
        if ((next.assignedEmployeeIds?.length ?? 0) > 0 && next.notifyEmployee === false && bulkNotify) {
          next.notifyEmployee = true;
        }
        return next;
      })
    );
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    for (const r of rows) {
      if (!r.jobTitle?.trim()) errs[r.proposalId] = "Chybí název zakázky.";
      else if (props.applyMode === "jobs" && !r.customerId && !r.createNewCustomer) {
        if (!r.customerName?.trim() || !r.email?.trim() || !r.phone?.trim() || !r.address?.trim()) {
          errs[r.proposalId] = "Vyberte zákazníka nebo vyplňte nového (jméno, e-mail, telefon, adresa).";
        }
      }
    }
    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const drafts: ChatWorkIntentApplyDraftsByProposal = {};
    for (const r of rows) {
      drafts[r.proposalId] = {
        jobTitle: r.jobTitle.trim(),
        scheduledDate: r.scheduledDate || null,
        scheduledEndDate: r.scheduledEndDate || null,
        customerId: r.customerId,
        customerName: r.customerName,
        email: r.email,
        phone: r.phone,
        address: r.address,
        createNewCustomer: r.createNewCustomer,
        note: r.note,
        assignedEmployeeIds: r.assignedEmployeeIds,
        notifyEmployee: r.notifyEmployee,
      };
    }
    props.onSubmit(drafts, rows.map((r) => r.proposalId));
  };

  const filteredEmployees = useMemo(() => {
    const q = empFilter.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      formatEmployeeDisplayName(e, String(e.id)).toLowerCase().includes(q)
    );
  }, [employees, empFilter]);

  const failedIds = useMemo(() => {
    if (!props.applyResults) return new Set<string>();
    return new Set(props.applyResults.filter((r) => !r.ok).map((r) => r.proposalId));
  }, [props.applyResults]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[min(96vw,980px)] max-h-[92vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>
            Hromadná kontrola ({rows.length} {rows.length === 1 ? "položka" : "položek"})
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-3 space-y-3 overflow-y-auto flex-1 min-h-0">
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
            <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
              Použít pro všechny vybrané zakázky
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Zákazník (hromadně)</Label>
                <Input
                  placeholder="Hledat zákazníka…"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                />
                {customerHits.length ? (
                  <ul className="border rounded-md max-h-28 overflow-y-auto text-xs">
                    {customerHits.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="w-full text-left px-2 py-1.5 hover:bg-muted"
                          onClick={() => {
                            setBulkCustomerId(c.id);
                            setCustomerQuery(c.label);
                          }}
                        >
                          {c.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Společná poznámka</Label>
                <Textarea
                  rows={2}
                  value={bulkNote}
                  onChange={(e) => setBulkNote(e.target.value)}
                  placeholder="Volitelně přidat ke všem…"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Zaměstnanci (hromadně)</Label>
              <ul className="max-h-32 overflow-y-auto border rounded-md divide-y">
                {filteredEmployees.map((e) => {
                  const id = String(e.id);
                  const on = bulkEmpIds.includes(id);
                  return (
                    <li key={id} className="flex items-center gap-2 p-2">
                      <Checkbox
                        checked={on}
                        onCheckedChange={() =>
                          setBulkEmpIds((ids) =>
                            on ? ids.filter((x) => x !== id) : [...ids, id]
                          )
                        }
                      />
                      <span className="text-xs">{formatEmployeeDisplayName(e, id)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={bulkNotify} onCheckedChange={(v) => setBulkNotify(v === true)} />
              Odeslat zaměstnancům zprávu po vytvoření
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={overwriteManual}
                onCheckedChange={(v) => setOverwriteManual(v === true)}
              />
              Přepsat i ručně upravené karty
            </label>
            <Button type="button" size="sm" variant="secondary" onClick={applyBulkToAll}>
              Použít hromadné nastavení
            </Button>
          </div>

          <ul className="space-y-4">
            {rows.map((r, idx) => (
              <li
                key={r.proposalId}
                className={cn(
                  "rounded-xl border-2 p-4 space-y-3 bg-card shadow-sm",
                  validationErrors[r.proposalId] && "border-destructive/60",
                  failedIds.has(r.proposalId) && "ring-2 ring-destructive/40"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-sm uppercase tracking-wide">
                    Zakázka {idx + 1}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-destructive"
                    onClick={() =>
                      setRows((list) => list.filter((x) => x.proposalId !== r.proposalId))
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Odebrat
                  </Button>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  <div className="space-y-1 md:col-span-2">
                    <Label>Název zakázky *</Label>
                    <Input
                      value={r.jobTitle}
                      onChange={(e) => updateRow(r.proposalId, { jobTitle: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Datum zahájení</Label>
                    <Input
                      type="date"
                      value={r.scheduledDate ?? ""}
                      onChange={(e) =>
                        updateRow(r.proposalId, { scheduledDate: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Datum dokončení</Label>
                    <Input
                      type="date"
                      value={r.scheduledEndDate ?? ""}
                      onChange={(e) =>
                        updateRow(r.proposalId, { scheduledEndDate: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2 border-t pt-3">
                  <Label>Zákazník</Label>
                  {r.customerId ? (
                    <p className="text-xs text-muted-foreground">Vybráno ID: {r.customerId}</p>
                  ) : null}
                  <Input
                    placeholder="Hledat nebo zadat jméno / firmu"
                    value={r.customerName ?? ""}
                    onFocus={() => setActiveCustomerProposalId(r.proposalId)}
                    onChange={(e) => {
                      setActiveCustomerProposalId(r.proposalId);
                      setCustomerQuery(e.target.value);
                      updateRow(r.proposalId, {
                        customerName: e.target.value,
                        dirtyCustomer: true,
                        createNewCustomer: true,
                        customerId: null,
                      });
                    }}
                  />
                  {activeCustomerProposalId === r.proposalId && customerHits.length ? (
                    <ul className="border rounded-md max-h-24 overflow-y-auto text-xs">
                      {customerHits.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            className="w-full text-left px-2 py-1 hover:bg-muted"
                            onClick={() =>
                              updateRow(r.proposalId, {
                                customerId: c.id,
                                customerName: c.label.split(" · ")[0] ?? c.label,
                                createNewCustomer: false,
                                dirtyCustomer: true,
                              })
                            }
                          >
                            {c.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="grid md:grid-cols-3 gap-2">
                    <Input
                      placeholder="E-mail"
                      value={r.email ?? ""}
                      onChange={(e) =>
                        updateRow(r.proposalId, { email: e.target.value, dirtyCustomer: true })
                      }
                    />
                    <Input
                      placeholder="Telefon"
                      value={r.phone ?? ""}
                      onChange={(e) =>
                        updateRow(r.proposalId, { phone: e.target.value, dirtyCustomer: true })
                      }
                    />
                    <Input
                      placeholder="Adresa"
                      value={r.address ?? ""}
                      onChange={(e) =>
                        updateRow(r.proposalId, { address: e.target.value, dirtyCustomer: true })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2 border-t pt-3">
                  <Label>Přiřadit zaměstnance</Label>
                  <div className="relative max-w-md">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-9 h-9 text-xs"
                      placeholder="Hledat zaměstnance…"
                      value={empFilter}
                      onChange={(e) => setEmpFilter(e.target.value)}
                    />
                  </div>
                  <ul className="max-h-36 overflow-y-auto border rounded-md divide-y">
                    {filteredEmployees.map((e) => {
                      const id = String(e.id);
                      const on = r.assignedEmployeeIds?.includes(id);
                      const photo = String(e.profileImage ?? e.photoURL ?? "").trim();
                      return (
                        <li key={id} className="flex items-center gap-2 p-2">
                          <Checkbox
                            checked={on}
                            onCheckedChange={() => {
                              const next = on
                                ? (r.assignedEmployeeIds ?? []).filter((x) => x !== id)
                                : [...(r.assignedEmployeeIds ?? []), id];
                              updateRow(r.proposalId, {
                                assignedEmployeeIds: next,
                                dirtyEmployees: true,
                                notifyEmployee: next.length ? true : r.notifyEmployee,
                              });
                            }}
                          />
                          <Avatar className="h-7 w-7">
                            <AvatarImage src={photo || undefined} />
                            <AvatarFallback className="text-[10px]">
                              {formatEmployeeDisplayName(e, id).slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-xs flex-1">
                            {formatEmployeeDisplayName(e, id)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="space-y-1 border-t pt-3">
                  <Label>Poznámka k zakázce</Label>
                  <Textarea
                    rows={3}
                    value={r.note ?? ""}
                    onChange={(e) =>
                      updateRow(r.proposalId, { note: e.target.value, dirtyNote: true })
                    }
                  />
                </div>

                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={r.notifyEmployee}
                    onCheckedChange={(v) =>
                      updateRow(r.proposalId, { notifyEmployee: v === true })
                    }
                  />
                  Odeslat zaměstnanci zprávu
                </label>

                {validationErrors[r.proposalId] ? (
                  <p className="text-xs text-destructive">{validationErrors[r.proposalId]}</p>
                ) : null}
              </li>
            ))}
          </ul>

          {props.applyResults?.length ? (
            <ul className="text-xs space-y-1 border-t pt-3">
              {props.applyResults.map((res) => (
                <li key={res.proposalId}>
                  {res.ok && res.jobId ? (
                    <span className="text-emerald-700">
                      OK:{" "}
                      <Link href={`/portal/jobs/${encodeURIComponent(res.jobId)}`} className="underline">
                        {res.jobName ?? res.jobId}
                      </Link>
                    </span>
                  ) : res.ok ? (
                    <span className="text-emerald-700">Uloženo</span>
                  ) : (
                    <span className="text-destructive">{res.error ?? "Chyba"}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {props.applyError ? (
            <p className="text-sm text-destructive">{props.applyError}</p>
          ) : null}
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-background shrink-0 sticky bottom-0">
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Zavřít
          </Button>
          {failedIds.size > 0 && props.onRetryFailed ? (
            <Button type="button" variant="secondary" onClick={props.onRetryFailed}>
              Opakovat neúspěšné ({failedIds.size})
            </Button>
          ) : null}
          <Button
            type="button"
            className="bg-orange-600 hover:bg-orange-700 text-white min-w-[180px]"
            disabled={props.applying || rows.length === 0}
            onClick={handleSubmit}
          >
            {props.applying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              `Vytvořit ${rows.length} zakázek`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
