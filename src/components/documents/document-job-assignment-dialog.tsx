"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Firestore } from "firebase/firestore";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  effectiveCompanyDocumentAssignmentTypeForForm,
  documentShowsAsPendingAssignment,
  type CompanyDocumentAssignmentLike,
  type CompanyDocumentEditAssignmentType,
  documentJobLinkId,
} from "@/lib/company-document-assignment";
import {
  allocationBasisGrossCzk,
  computeAllocationGrossCzkShares,
  makeJobCostAllocationId,
  resolveJobCostAllocationsFromDocument,
  validateJobCostAllocations,
  type JobCostAllocationMode,
} from "@/lib/company-document-job-allocations";
import {
  allocationFormRowsToDomain,
  documentAllocationTotalsCzk,
  documentJobCostAllocationAmountBasis,
  domainRowsToAllocationForm,
  type AllocationAmountInputBasis,
  type AllocationFormRowInput,
  switchAllocationFormBasis,
} from "@/lib/company-document-allocation-vat";
import {
  persistDocumentJobAllocations,
  persistDocumentNonJobAssignment,
} from "@/lib/document-job-assignment-persist";
import { roundMoney2 } from "@/lib/vat-calculations";
import { sendModuleEmailNotificationFromBrowser } from "@/lib/email-notifications/client";
type JobOption = { id: string; name: string };

export type DocumentJobAssignmentDialogDocument = Record<string, unknown> &
  CompanyDocumentAssignmentLike & {
    id: string;
    number?: string | null;
    entityName?: string | null;
    documentType?: string | null;
    assignmentType?: string | null;
  };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: DocumentJobAssignmentDialogDocument | null;
  jobs: JobOption[];
  companyId: string;
  userId: string;
  firestore: Firestore;
  onSaved?: () => void;
};

function docTitle(d: DocumentJobAssignmentDialogDocument): string {
  return (
    d.number?.trim() ||
    String(d.entityName ?? "").trim() ||
    d.id
  );
}

export function DocumentJobAssignmentDialog(props: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [assignType, setAssignType] =
    useState<CompanyDocumentEditAssignmentType>("pending_assignment");
  const [singleJobId, setSingleJobId] = useState("");
  const [splitMode, setSplitMode] = useState(false);
  const [allocMode, setAllocMode] = useState<JobCostAllocationMode>("amount");
  const [inputBasis, setInputBasis] =
    useState<AllocationAmountInputBasis>("gross");
  const [rows, setRows] = useState<AllocationFormRowInput[]>([]);

  const doc = props.document;

  const totals = useMemo(() => {
    if (!doc) {
      return { net: 0, vat: 0, gross: 0, vatRatePercent: 0 };
    }
    return documentAllocationTotalsCzk(doc);
  }, [doc]);

  const basisGross = useMemo(() => {
    if (!doc) return 0;
    return allocationBasisGrossCzk(doc);
  }, [doc]);

  const initFromDocument = useCallback(() => {
    if (!doc) return;
    let at = effectiveCompanyDocumentAssignmentTypeForForm(doc);
    if (at === "overhead") at = "company";
    setAssignType(at);
    setSingleJobId(documentJobLinkId(doc));
    const resolved = resolveJobCostAllocationsFromDocument(doc);
    const explicitMulti =
      resolved.usesExplicitAllocations &&
      resolved.rows.filter((r) => r.kind === "job").length > 1;
    const hasExplicitAmounts =
      resolved.usesExplicitAllocations &&
      resolved.rows.some((r) => (r.amount ?? 0) > 0 || (r.percent ?? 0) > 0);
    setSplitMode(explicitMulti || hasExplicitAmounts);
    setAllocMode(resolved.mode);
    setInputBasis(documentJobCostAllocationAmountBasis(doc));
    if (resolved.rows.length > 0 && (explicitMulti || hasExplicitAmounts)) {
      setRows(
        domainRowsToAllocationForm(
          resolved.rows,
          resolved.mode,
          documentJobCostAllocationAmountBasis(doc),
          documentAllocationTotalsCzk(doc)
        )
      );
    } else {
      const jid = documentJobLinkId(doc);
      setRows([
        {
          id: makeJobCostAllocationId(),
          kind: "job",
          jobId: jid,
          amount: basisGross > 0 ? String(basisGross) : "",
          percent: "",
          note: "",
        },
      ]);
    }
  }, [doc, basisGross]);

  useEffect(() => {
    if (props.open && doc) initFromDocument();
  }, [props.open, doc, initFromDocument]);

  const domainRows = useMemo(
    () =>
      allocationFormRowsToDomain({
        mode: allocMode,
        inputBasis,
        totals,
        rows,
      }),
    [allocMode, inputBasis, totals, rows]
  );

  const validation = useMemo(
    () =>
      assignType === "job_cost" && (splitMode || domainRows.some((r) => r.kind === "job"))
        ? validateJobCostAllocations({
            mode: allocMode,
            rows: domainRows,
            basisGrossCzk: basisGross,
            allowPartial: true,
          })
        : ({ ok: true } as const)
    ,
    [assignType, splitMode, domainRows, allocMode, basisGross]
  );

  const allocatedGross = useMemo(() => {
    if (allocMode === "amount") {
      let s = 0;
      for (const r of domainRows) s += Number(r.amount ?? 0);
      return roundMoney2(s);
    }
    const shares = computeAllocationGrossCzkShares({
      mode: "percent",
      rows: domainRows,
      basisGrossCzk: basisGross,
    });
    let s = 0;
    for (const g of shares.values()) s += g;
    return roundMoney2(s);
  }, [allocMode, domainRows, basisGross]);

  const remainderGross = roundMoney2(basisGross - allocatedGross);

  const duplicateJobIds = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) {
      if (r.kind !== "job") continue;
      const j = r.jobId.trim();
      if (!j) continue;
      c.set(j, (c.get(j) ?? 0) + 1);
    }
    return [...c.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  }, [rows]);

  const fillRemainder = () => {
    setRows((prev) => {
      if (prev.length === 0) return prev;
      if (allocMode === "percent") {
        const d = allocationFormRowsToDomain({
          mode: allocMode,
          inputBasis,
          totals,
          rows: prev,
        });
        let sumP = 0;
        for (let i = 0; i < d.length - 1; i++) sumP += Number(d[i].percent ?? 0);
        const rest = roundMoney2(Math.max(0, 100 - sumP));
        const last = { ...prev[prev.length - 1] };
        last.percent = String(rest);
        return [...prev.slice(0, -1), last];
      }
      const d = allocationFormRowsToDomain({
        mode: allocMode,
        inputBasis,
        totals,
        rows: prev,
      });
      let sum = 0;
      for (let i = 0; i < d.length - 1; i++) sum += Number(d[i].amount ?? 0);
      const restGross = roundMoney2(Math.max(0, basisGross - sum));
      const display =
        inputBasis === "gross"
          ? restGross
          : roundMoney2(
              totals.vatRatePercent > 0
                ? restGross / (1 + totals.vatRatePercent / 100)
                : restGross
            );
      const last = { ...prev[prev.length - 1] };
      last.amount = String(display);
      return [...prev.slice(0, -1), last];
    });
  };

  const handleSave = async () => {
    if (!doc || !props.companyId || !props.userId) return;
    setSaving(true);
    try {
      if (assignType === "job_cost") {
        if (!splitMode) {
          if (!singleJobId.trim()) {
            toast({
              variant: "destructive",
              title: "Vyberte zakázku",
            });
            setSaving(false);
            return;
          }
          const oneRow = [
            {
              id: makeJobCostAllocationId(),
              kind: "job" as const,
              jobId: singleJobId.trim(),
              amount: basisGross > 0 ? basisGross : null,
              percent: null,
              note: null,
              linkedExpenseId: null,
            },
          ];
          const sel = props.jobs.find((j) => j.id === singleJobId.trim());
          await persistDocumentJobAllocations({
            firestore: props.firestore,
            companyId: props.companyId,
            userId: props.userId,
            documentId: doc.id,
            mode: "amount",
            amountBasis: inputBasis,
            rows: oneRow,
            jobDisplayName: sel?.name ?? null,
          });
        } else {
          if (duplicateJobIds.length > 0) {
            toast({
              variant: "destructive",
              title: "Duplicitní zakázka",
              description: "Sloučte řádky se stejnou zakázkou.",
            });
            setSaving(false);
            return;
          }
          if (!validation.ok) {
            toast({
              variant: "destructive",
              title: "Rozdělení",
              description: validation.message,
            });
            setSaving(false);
            return;
          }
          const hasJob = domainRows.some(
            (r) => r.kind === "job" && r.jobId?.trim()
          );
          if (!hasJob) {
            toast({
              variant: "destructive",
              title: "Chybí zakázka",
              description: "Přidejte alespoň jeden řádek se zakázkou.",
            });
            setSaving(false);
            return;
          }
          const firstJid = domainRows.find(
            (r) => r.kind === "job" && r.jobId?.trim()
          )?.jobId;
          const sel = props.jobs.find((j) => j.id === firstJid);
          await persistDocumentJobAllocations({
            firestore: props.firestore,
            companyId: props.companyId,
            userId: props.userId,
            documentId: doc.id,
            mode: allocMode,
            amountBasis: inputBasis,
            rows: domainRows,
            jobDisplayName: sel?.name ?? null,
          });
        }
      } else if (assignType === "pending_assignment") {
        await persistDocumentJobAllocations({
          firestore: props.firestore,
          companyId: props.companyId,
          userId: props.userId,
          documentId: doc.id,
          mode: "amount",
          amountBasis: inputBasis,
          rows: [],
          clearToPending: true,
        });
      } else {
        await persistDocumentNonJobAssignment({
          firestore: props.firestore,
          companyId: props.companyId,
          userId: props.userId,
          documentId: doc.id,
          assignmentType: assignType,
          selectedJobId: null,
        });
      }

      if (
        documentShowsAsPendingAssignment(doc) &&
        assignType !== "pending_assignment"
      ) {
        const selected = props.jobs.find((j) => j.id === singleJobId);
        let line = "";
        if (assignType === "job_cost") {
          line = `Zařazeno do nákladů zakázky: ${selected?.name ?? singleJobId ?? "—"}`;
        } else if (assignType === "warehouse") line = "Zařazeno ke skladu";
        else if (assignType === "company") line = "Zařazeno jako režie firmy";
        void sendModuleEmailNotificationFromBrowser({
          companyId: props.companyId,
          module: "documents",
          eventKey: "updated",
          entityId: doc.id,
          title: `Doklad zařazen: ${docTitle(doc)}`,
          lines: [line].filter(Boolean),
          actionPath: `/portal/documents`,
        });
      }

      toast({ title: "Přiřazení uloženo" });
      props.onOpenChange(false);
      props.onSaved?.();
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Uložení se nepovedlo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSaving(false);
    }
  };

  const amountLabel =
    allocMode === "percent"
      ? "Procenta"
      : inputBasis === "gross"
        ? "Částka s DPH"
        : "Částka bez DPH";

  const dialogTitle =
    splitMode || (doc && resolveJobCostAllocationsFromDocument(doc).usesExplicitAllocations)
      ? "Upravit přiřazení / rozdělení"
      : doc && documentJobLinkId(doc)
        ? "Upravit přiřazení"
        : "Přiřadit na zakázku";

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            Stav úhrady neovlivňuje přiřazení na zakázku. Rozdělení je účetní
            členění nákladu.
          </DialogDescription>
        </DialogHeader>

        {doc ? (
          <div className="space-y-4 py-1">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
              <p className="font-medium truncate">{docTitle(doc)}</p>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-3 tabular-nums text-muted-foreground">
                <span>
                  Bez DPH:{" "}
                  <strong className="text-foreground">
                    {totals.net.toLocaleString("cs-CZ")} Kč
                  </strong>
                </span>
                <span>
                  DPH:{" "}
                  <strong className="text-foreground">
                    {totals.vat.toLocaleString("cs-CZ")} Kč
                  </strong>
                </span>
                <span>
                  S DPH:{" "}
                  <strong className="text-foreground">
                    {totals.gross.toLocaleString("cs-CZ")} Kč
                  </strong>
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Zařazení</Label>
              <Select
                value={assignType}
                onValueChange={(v) =>
                  setAssignType(v as CompanyDocumentEditAssignmentType)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="job_cost">Zakázka (náklad)</SelectItem>
                  <SelectItem value="company">Firma (režie)</SelectItem>
                  <SelectItem value="warehouse">Sklad</SelectItem>
                  <SelectItem value="pending_assignment">
                    Nezařazeno (později)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {assignType === "job_cost" ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label htmlFor="split-mode">Rozdělit mezi více zakázek</Label>
                    <p className="text-xs text-muted-foreground">
                      Vypnuto = celý doklad na jednu zakázku
                    </p>
                  </div>
                  <Switch
                    id="split-mode"
                    checked={splitMode}
                    onCheckedChange={(v) => {
                      setSplitMode(v);
                      if (v && rows.length === 0) {
                        setRows([
                          {
                            id: makeJobCostAllocationId(),
                            kind: "job",
                            jobId: singleJobId,
                            amount: "",
                            percent: "",
                            note: "",
                          },
                        ]);
                      }
                    }}
                  />
                </div>

                {!splitMode ? (
                  <div className="space-y-2">
                    <Label>Zakázka</Label>
                    <Select value={singleJobId} onValueChange={setSingleJobId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Vyberte zakázku" />
                      </SelectTrigger>
                      <SelectContent>
                        {props.jobs.map((j) => (
                          <SelectItem key={j.id} value={j.id}>
                            {j.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-3 border-t pt-3">
                    <div className="space-y-2">
                      <Label>Režim zadávání</Label>
                      <Select
                        value={allocMode}
                        onValueChange={(v) =>
                          setAllocMode(v as JobCostAllocationMode)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="amount">Částky (Kč)</SelectItem>
                          <SelectItem value="percent">Procenta</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {allocMode === "amount" ? (
                      <div className="space-y-1">
                        <Label>Zadávám</Label>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={inputBasis === "gross" ? "default" : "outline"}
                            onClick={() => {
                              if (inputBasis === "gross") return;
                              setRows((prev) =>
                                switchAllocationFormBasis(
                                  prev,
                                  inputBasis,
                                  "gross",
                                  totals,
                                  allocMode
                                )
                              );
                              setInputBasis("gross");
                            }}
                          >
                            S DPH
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={inputBasis === "net" ? "default" : "outline"}
                            onClick={() => {
                              if (inputBasis === "net") return;
                              setRows((prev) =>
                                switchAllocationFormBasis(
                                  prev,
                                  inputBasis,
                                  "net",
                                  totals,
                                  allocMode
                                )
                              );
                              setInputBasis("net");
                            }}
                          >
                            Bez DPH
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    <div className="text-sm space-y-0.5 tabular-nums">
                      <p>
                        Rozděleno:{" "}
                        <span className="font-medium">
                          {allocatedGross.toLocaleString("cs-CZ")} Kč
                        </span>{" "}
                        <span className="text-muted-foreground">(s DPH)</span>
                      </p>
                      <p
                        className={cn(
                          Math.abs(remainderGross) <= 0.05
                            ? "text-emerald-700"
                            : "text-amber-900"
                        )}
                      >
                        Zbývá: {remainderGross.toLocaleString("cs-CZ")} Kč
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="gap-1"
                        onClick={() =>
                          setRows((rs) => [
                            ...rs,
                            {
                              id: makeJobCostAllocationId(),
                              kind: "job",
                              jobId: "",
                              amount: "",
                              percent: "",
                              note: "",
                            },
                          ])
                        }
                      >
                        <Plus className="h-3.5 w-3.5" /> Přidat zakázku
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={fillRemainder}
                        disabled={rows.length === 0}
                      >
                        Doplnit zbytek
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {rows.map((ar) => (
                        <div
                          key={ar.id}
                          className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-12 sm:items-end"
                        >
                          <div className="sm:col-span-5">
                            <Label className="text-xs text-muted-foreground">
                              Zakázka
                            </Label>
                            <Select
                              value={ar.jobId || "__none__"}
                              onValueChange={(v) =>
                                setRows((rs) =>
                                  rs.map((r) =>
                                    r.id === ar.id
                                      ? {
                                          ...r,
                                          jobId: v === "__none__" ? "" : v,
                                        }
                                      : r
                                  )
                                )
                              }
                            >
                              <SelectTrigger className="h-10">
                                <SelectValue placeholder="Vyberte" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">—</SelectItem>
                                {props.jobs.map((j) => (
                                  <SelectItem key={j.id} value={j.id}>
                                    {j.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="sm:col-span-4">
                            <Label className="text-xs text-muted-foreground">
                              {amountLabel}
                            </Label>
                            <Input
                              className="h-10 tabular-nums"
                              type="number"
                              min={0}
                              step={allocMode === "amount" ? "0.01" : "0.1"}
                              value={
                                allocMode === "amount" ? ar.amount : ar.percent
                              }
                              onChange={(e) =>
                                setRows((rs) =>
                                  rs.map((r) =>
                                    r.id === ar.id
                                      ? allocMode === "amount"
                                        ? { ...r, amount: e.target.value }
                                        : { ...r, percent: e.target.value }
                                      : r
                                  )
                                )
                              }
                            />
                          </div>
                          <div className="sm:col-span-3 flex sm:justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              disabled={rows.length <= 1}
                              onClick={() =>
                                setRows((rs) => rs.filter((r) => r.id !== ar.id))
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {duplicateJobIds.length > 0 ? (
                      <Alert variant="destructive">
                        <AlertTitle>Duplicitní zakázka</AlertTitle>
                        <AlertDescription>
                          Stejná zakázka je ve více řádcích.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    {!validation.ok ? (
                      <Alert className="border-amber-300 bg-amber-50">
                        <AlertTitle>Kontrola rozdělení</AlertTitle>
                        <AlertDescription>{validation.message}</AlertDescription>
                      </Alert>
                    ) : null}
                  </div>
                )}
              </>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => props.onOpenChange(false)}
          >
            Zrušit
          </Button>
          <Button
            className="w-full sm:w-auto"
            disabled={saving || !doc}
            onClick={() => void handleSave()}
          >
            {saving ? "Ukládám…" : "Uložit přiřazení"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
