"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
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
import type { ChatWorkIntentProposal } from "@/lib/chat/chat-work-intent-types";
import type { ChatWorkIntentJobApplyDraft } from "@/lib/chat/chat-work-intent-apply-types";
import {
  filterEmployeesForAssignment,
  formatEmployeeDisplayName,
} from "@/lib/employee-active";
import { validateNewCustomerForJob } from "@/lib/job-create-customer-validation";

export function ChatWorkIntentProposalEditDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  proposal: ChatWorkIntentProposal | null;
  draft: ChatWorkIntentJobApplyDraft | null;
  proposalIndex: number;
  title?: string;
  onSave: (proposal: ChatWorkIntentProposal, draft: ChatWorkIntentJobApplyDraft) => void;
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

  const [proposal, setProposal] = useState<ChatWorkIntentProposal | null>(null);
  const [draft, setDraft] = useState<ChatWorkIntentJobApplyDraft | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerHits, setCustomerHits] = useState<Array<{ id: string; label: string }>>([]);
  const [empFilter, setEmpFilter] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open || !props.proposal || !props.draft) return;
    setProposal({ ...props.proposal });
    setDraft({ ...props.draft });
    setValidationError(null);
    setCustomerQuery("");
    setCustomerHits([]);
  }, [props.open, props.proposal, props.draft]);

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
      const data = (await res.json()) as {
        ok?: boolean;
        customers?: Array<{ id: string; label: string }>;
      };
      setCustomerHits(data.ok ? data.customers ?? [] : []);
    },
    [user]
  );

  useEffect(() => {
    const t = setTimeout(() => void searchCustomers(customerQuery), 280);
    return () => clearTimeout(t);
  }, [customerQuery, searchCustomers]);

  const filteredEmployees = useMemo(() => {
    const q = empFilter.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      formatEmployeeDisplayName(e, String(e.id)).toLowerCase().includes(q)
    );
  }, [employees, empFilter]);

  const employeeCount = draft?.assignedEmployeeIds?.length ?? 0;
  const notifyDisabled = employeeCount === 0;

  const handleSave = () => {
    if (!proposal || !draft) return;
    if (!draft.jobTitle?.trim()) {
      setValidationError("Název zakázky je povinný.");
      return;
    }
    if (!draft.customerId) {
      const errs = validateNewCustomerForJob({
        name: draft.customerName ?? "",
        email: draft.email ?? "",
        phone: draft.phone ?? "",
        address: draft.address ?? "",
      });
      const first = Object.values(errs)[0];
      if (first) {
        setValidationError(first);
        return;
      }
    }
    setValidationError(null);
    props.onSave(proposal, {
      ...draft,
      jobTitle: draft.jobTitle.trim(),
      createNewCustomer: !draft.customerId,
      notifyEmployee: employeeCount > 0 ? draft.notifyEmployee !== false : false,
    });
    props.onOpenChange(false);
  };

  if (!proposal || !draft) return null;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[min(96vw,720px)] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{props.title ?? "Upravit návrh"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="space-y-1">
            <Label>Název zakázky *</Label>
            <Input
              value={draft.jobTitle}
              onChange={(e) => setDraft({ ...draft, jobTitle: e.target.value })}
            />
          </div>

          <div className="space-y-2 rounded-lg border p-3 bg-muted/20">
            <Label>Zákazník</Label>
            {draft.customerId ? (
              <p className="text-xs text-muted-foreground">Propojeno se zákazníkem v adresáři.</p>
            ) : null}
            <Input
              placeholder="Hledat nebo zadat jméno / firmu"
              value={draft.customerName ?? ""}
              onChange={(e) => {
                setCustomerQuery(e.target.value);
                setDraft({
                  ...draft,
                  customerName: e.target.value,
                  customerId: null,
                  createNewCustomer: true,
                });
              }}
            />
            {customerHits.length ? (
              <ul className="border rounded-md max-h-28 overflow-y-auto text-xs">
                {customerHits.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="w-full text-left px-2 py-1.5 hover:bg-muted"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          customerId: c.id,
                          customerName: c.label.split(" · ")[0] ?? c.label,
                          createNewCustomer: false,
                        })
                      }
                    >
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="grid sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">E-mail</Label>
                <Input
                  value={draft.email ?? ""}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Telefon</Label>
                <Input
                  value={draft.phone ?? ""}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Adresa</Label>
              <Input
                value={draft.address ?? ""}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Datum zahájení</Label>
              <Input
                type="date"
                value={draft.scheduledDate ?? ""}
                onChange={(e) => setDraft({ ...draft, scheduledDate: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Datum dokončení</Label>
              <Input
                type="date"
                value={draft.scheduledEndDate ?? ""}
                onChange={(e) => setDraft({ ...draft, scheduledEndDate: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Popis</Label>
            <Textarea
              rows={2}
              value={proposal.description ?? ""}
              onChange={(e) => setProposal({ ...proposal, description: e.target.value })}
            />
          </div>

          <div className="space-y-2 border-t pt-3">
            <Label>Přiřadit zaměstnance</Label>
            <div className="relative max-w-md">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Hledat zaměstnance…"
                value={empFilter}
                onChange={(e) => setEmpFilter(e.target.value)}
              />
            </div>
            <ul className="max-h-40 overflow-y-auto border rounded-md divide-y">
              {filteredEmployees.map((e) => {
                const id = String(e.id);
                const on = draft.assignedEmployeeIds?.includes(id);
                const photo = String(e.profileImage ?? e.photoURL ?? "").trim();
                return (
                  <li key={id} className="flex items-center gap-2 p-2">
                    <Checkbox
                      checked={on}
                      onCheckedChange={() => {
                        const next = on
                          ? (draft.assignedEmployeeIds ?? []).filter((x) => x !== id)
                          : [...(draft.assignedEmployeeIds ?? []), id];
                        setDraft({
                          ...draft,
                          assignedEmployeeIds: next,
                          notifyEmployee: next.length ? draft.notifyEmployee !== false : false,
                        });
                      }}
                    />
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={photo || undefined} />
                      <AvatarFallback className="text-[10px]">
                        {formatEmployeeDisplayName(e, id).slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-xs flex-1">{formatEmployeeDisplayName(e, id)}</span>
                  </li>
                );
              })}
            </ul>
            {(draft.assignedEmployeeIds?.length ?? 0) > 0 ? (
              <p className="text-xs text-muted-foreground">
                Vybráno:{" "}
                {(draft.assignedEmployeeIds ?? [])
                  .map((id) => {
                    const emp = employees.find((x) => String(x.id) === id);
                    return emp ? formatEmployeeDisplayName(emp, id) : id;
                  })
                  .join(", ")}
              </p>
            ) : (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Zatím není vybrán žádný zaměstnanec.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label>Pokyny pro zaměstnance</Label>
            <Textarea
              rows={3}
              placeholder="Zavolej zákazníkovi, potvrď termín a připrav materiál."
              value={draft.note ?? ""}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <label
              className={`flex items-center gap-2 text-xs ${notifyDisabled ? "opacity-60" : ""}`}
            >
              <Checkbox
                disabled={notifyDisabled}
                checked={!notifyDisabled && draft.notifyEmployee !== false}
                onCheckedChange={(v) => setDraft({ ...draft, notifyEmployee: v === true })}
              />
              Po vytvoření zakázky odeslat zaměstnanci zprávu
            </label>
            {notifyDisabled ? (
              <p className="text-[10px] text-muted-foreground">
                Nejprve vyberte alespoň jednoho zaměstnance.
              </p>
            ) : null}
          </div>

          {validationError ? (
            <p className="text-sm text-destructive">{validationError}</p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Zrušit
          </Button>
          <Button
            type="button"
            className="bg-orange-600 hover:bg-orange-700 text-white"
            onClick={handleSave}
          >
            Uložit úpravy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
