"use client";

import React, { useMemo, useState } from "react";
import type { Firestore } from "firebase/firestore";
import { collection, deleteDoc, doc, query, where } from "firebase/firestore";
import type { User } from "firebase/auth";
import { useCollection, useMemoFirebase } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, Download, Mail, Pencil, PenLine, Eye, Trash2 } from "lucide-react";
import { HandoverProtocolFormDialog } from "@/components/handover-protocols/handover-protocol-form-dialog";
import { HandoverProtocolEmailDialog } from "@/components/handover-protocols/handover-protocol-email-dialog";
import { HandoverProtocolPdfPreviewDialog } from "@/components/handover-protocols/handover-protocol-pdf-preview-dialog";
import { HandoverProtocolSignatureDialog } from "@/components/handover-protocols/handover-protocol-signature-dialog";
import {
  HANDOVER_PROTOCOL_STATUS_LABELS,
  handoverProtocolFormFromDoc,
  type HandoverProtocolDoc,
} from "@/lib/handover-protocol-types";
import type { WorkContractDoc } from "@/lib/work-contract-print-html-build";
import { downloadHandoverProtocolPdf } from "@/lib/handover-protocol-client-api";
import type { ActivityActorProfile } from "@/lib/activity-log";
import { logActivitySafe } from "@/lib/activity-log";

export function JobHandoverProtocolsSection(props: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  jobName: string;
  user: User;
  profile: ActivityActorProfile | null | undefined;
  companyDoc: Record<string, unknown> | null;
  workContracts: WorkContractDoc[];
  defaultCustomerEmail?: string | null;
  canEdit: boolean;
  formOpen: boolean;
  onFormOpenChange: (open: boolean) => void;
  defaultWorkContractId?: string | null;
  editProtocolId?: string | null;
  onEditProtocolIdChange?: (id: string | null) => void;
}) {
  const {
    firestore,
    companyId,
    jobId,
    jobName,
    user,
    profile,
    companyDoc,
    workContracts,
    defaultCustomerEmail,
    canEdit,
    formOpen,
    onFormOpenChange,
    defaultWorkContractId,
    editProtocolId: editProtocolIdProp,
    onEditProtocolIdChange,
  } = props;
  const { toast } = useToast();
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<HandoverProtocolDoc | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [emailCtx, setEmailCtx] = useState<HandoverProtocolDoc | null>(null);
  const [signCtx, setSignCtx] = useState<HandoverProtocolDoc | null>(null);
  const [deleting, setDeleting] = useState(false);

  const editProtocolId = editProtocolIdProp ?? editId;

  const q = useMemoFirebase(() => {
    if (!firestore || !companyId || !jobId) return null;
    return query(
      collection(firestore, "companies", companyId, "handoverProtocols"),
      where("jobId", "==", jobId)
    );
  }, [firestore, companyId, jobId]);

  const { data: raw, isLoading } = useCollection(q);

  const rows = useMemo(() => {
    const list = Array.isArray(raw) ? (raw as HandoverProtocolDoc[]) : [];
    return list
      .filter((r) => r && typeof r.id === "string")
      .sort((a, b) => String(b.protocolNumber ?? b.id).localeCompare(String(a.protocolNumber ?? a.id)));
  }, [raw]);

  const openEdit = (id: string) => {
    setEditId(id);
    onEditProtocolIdChange?.(id);
    onFormOpenChange(true);
  };

  const runDelete = async () => {
    if (!deleteId || !canEdit) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(firestore, "companies", companyId, "handoverProtocols", deleteId));
      logActivitySafe(firestore, companyId, user, profile, {
        actionType: "handover_protocol_deleted",
        actionLabel: "Smazán předávací protokol",
        entityType: "handover_protocol",
        entityId: deleteId,
        entityName: jobName,
        sourceModule: "zakazky",
        route: `/portal/jobs/${jobId}`,
      });
      toast({ title: "Protokol odstraněn" });
      setDeleteId(null);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Smazání se nezdařilo",
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setDeleting(false);
    }
  };

  const downloadPdf = async (row: HandoverProtocolDoc) => {
    try {
      const blob = await downloadHandoverProtocolPdf({
        user,
        companyId,
        protocolId: row.id,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `predavaci-protokol-${row.protocolNumber ?? row.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "PDF",
        description: e instanceof Error ? e.message : "",
      });
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Načítání předávacích protokolů…</p>;
  }

  if (rows.length === 0) {
    return (
      <>
        <p className="text-sm text-muted-foreground">Zatím žádné předávací protokoly.</p>
        <HandoverProtocolFormDialog
          open={formOpen}
          onOpenChange={(o) => {
            onFormOpenChange(o);
            if (!o) {
              setEditId(null);
              onEditProtocolIdChange?.(null);
            }
          }}
          firestore={firestore}
          companyId={companyId}
          jobId={jobId}
          jobName={jobName}
          user={user}
          profile={profile}
          companyDoc={companyDoc}
          workContracts={workContracts}
          editProtocolId={editProtocolId}
          defaultWorkContractId={defaultWorkContractId}
          defaultCustomerEmail={defaultCustomerEmail}
        />
      </>
    );
  }

  return (
    <>
      <div className="border-t border-border pt-4 space-y-3">
        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <ClipboardList className="h-3.5 w-3.5" />
          Předávací protokoly
        </p>
        <ul className="space-y-3">
          {rows.map((row) => {
            const form = handoverProtocolFormFromDoc(row as unknown as Record<string, unknown>);
            const status = row.status ?? "draft";
            return (
              <li key={row.id} className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">{form.documentTitle}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {row.protocolNumber ?? "—"} · Smlouva {row.workContractNumber ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Předání: {form.handoverDateLabel || "—"}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {HANDOVER_PROTOCOL_STATUS_LABELS[status] ?? status}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => {
                      setPreviewDoc({ ...row, form });
                      setPreviewOpen(true);
                    }}
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" /> Náhled
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => void downloadPdf(row)}
                  >
                    <Download className="h-3.5 w-3.5 mr-1" /> PDF
                  </Button>
                  {canEdit ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => openEdit(row.id)}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Upravit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => setEmailCtx({ ...row, form })}
                      >
                        <Mail className="h-3.5 w-3.5 mr-1" /> Odeslat
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-8 text-xs"
                        onClick={() => setSignCtx({ ...row, form })}
                      >
                        <PenLine className="h-3.5 w-3.5 mr-1" /> Podpis zhotovitele
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        className="h-8 text-xs"
                        onClick={() => setDeleteId(row.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Smazat
                      </Button>
                    </>
                  ) : null}
                </div>
                {(() => {
                  const emailHistory = Array.isArray(row.emailSendHistory)
                    ? row.emailSendHistory
                    : [];
                  return emailHistory.length > 0 ? (
                  <div className="text-xs text-muted-foreground border-t pt-2">
                    <p className="font-medium">Historie odeslání</p>
                    <ul className="mt-1 space-y-0.5">
                      {[...emailHistory].slice(-3).reverse().map((ev, i) => (
                        <li key={i}>
                          {String(ev.at ?? "").slice(0, 19).replace("T", " ")} — {ev.detail ?? "—"}
                        </li>
                      ))}
                    </ul>
                  </div>
                  ) : null;
                })()}
              </li>
            );
          })}
        </ul>
      </div>

      <HandoverProtocolFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          onFormOpenChange(o);
          if (!o) {
            setEditId(null);
            onEditProtocolIdChange?.(null);
          }
        }}
        firestore={firestore}
        companyId={companyId}
        jobId={jobId}
        jobName={jobName}
        user={user}
        profile={profile}
        companyDoc={companyDoc}
        workContracts={workContracts}
        editProtocolId={editProtocolId}
        defaultWorkContractId={defaultWorkContractId}
        defaultCustomerEmail={defaultCustomerEmail}
      />

      <HandoverProtocolPdfPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        protocol={previewDoc}
        companyDoc={companyDoc}
        user={user}
        showSendEmail={canEdit}
        onSendEmail={
          previewDoc && canEdit
            ? () => {
                setPreviewOpen(false);
                setEmailCtx(previewDoc);
              }
            : undefined
        }
      />

      {emailCtx ? (
        <HandoverProtocolEmailDialog
          open={!!emailCtx}
          onOpenChange={(o) => !o && setEmailCtx(null)}
          companyId={companyId}
          protocolId={emailCtx.id}
          documentTitle={emailCtx.form?.documentTitle ?? handoverProtocolFormFromDoc(emailCtx as never).documentTitle}
          jobName={String(emailCtx.jobName ?? jobName)}
          jobNumber={emailCtx.jobNumber}
          defaultTo={emailCtx.customerEmail ?? defaultCustomerEmail}
          user={user}
        />
      ) : null}

      {signCtx ? (
        <HandoverProtocolSignatureDialog
          open={!!signCtx}
          onOpenChange={(o) => !o && setSignCtx(null)}
          companyId={companyId}
          protocolId={signCtx.id}
          user={user}
          role="contractor"
        />
      ) : null}

      <AlertDialog open={deleteId != null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat předávací protokol?</AlertDialogTitle>
            <AlertDialogDescription>Tuto akci nelze vrátit.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Zrušit</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runDelete()} disabled={deleting}>
              {deleting ? "Mažu…" : "Smazat"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
