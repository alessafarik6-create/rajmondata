"use client";

import React, { useMemo, useState } from "react";
import { collection, doc, limit, query, updateDoc, arrayUnion, serverTimestamp, where } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import type { User } from "firebase/auth";
import { useCollection, useMemoFirebase } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardList, Download, Eye, PenLine, Paperclip } from "lucide-react";
import {
  HANDOVER_PROTOCOL_STATUS_LABELS,
  handoverProtocolFormFromDoc,
  type HandoverProtocolDoc,
} from "@/lib/handover-protocol-types";
import { HandoverProtocolPdfPreviewDialog } from "@/components/handover-protocols/handover-protocol-pdf-preview-dialog";
import { HandoverProtocolSignatureDialog } from "@/components/handover-protocols/handover-protocol-signature-dialog";
import { downloadHandoverProtocolPdf } from "@/lib/handover-protocol-client-api";
import { useToast } from "@/hooks/use-toast";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { getFirebaseStorage } from "@/firebase/storage";

function isSharedWithCustomer(row: HandoverProtocolDoc): boolean {
  return row.sharedWithCustomer === true || row.sentToCustomer === true;
}

export function CustomerJobHandoverProtocolsSection(props: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  user: User;
  companyDoc?: Record<string, unknown> | null;
  readOnly?: boolean;
}) {
  const { firestore, companyId, jobId, user, companyDoc, readOnly } = props;
  const { toast } = useToast();
  const [previewDoc, setPreviewDoc] = useState<HandoverProtocolDoc | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [signId, setSignId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteProtocolId, setNoteProtocolId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const q = useMemoFirebase(() => {
    if (!firestore || !companyId || !jobId) return null;
    return query(
      collection(firestore, "companies", companyId, "handoverProtocols"),
      where("jobId", "==", jobId),
      limit(80)
    );
  }, [firestore, companyId, jobId]);

  const { data: raw, isLoading } = useCollection(q);

  const rows = useMemo(() => {
    const list = Array.isArray(raw) ? (raw as HandoverProtocolDoc[]) : [];
    return list.filter((r) => r && isSharedWithCustomer(r));
  }, [raw]);

  const saveNote = async (protocolId: string) => {
    const text = noteText.trim();
    if (!text) return;
    try {
      await updateDoc(doc(firestore, "companies", companyId, "handoverProtocols", protocolId), {
        customerNotes: arrayUnion({
          id: `n-${Date.now()}`,
          text,
          at: new Date().toISOString(),
          byUserId: user.uid,
          byDisplayName: user.displayName ?? user.email ?? "Zákazník",
        }),
        activityHistory: arrayUnion({
          at: new Date().toISOString(),
          action: "customer_note",
          byUserId: user.uid,
          byDisplayName: user.displayName ?? null,
          detail: text.slice(0, 200),
        }),
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Poznámka uložena" });
      setNoteText("");
      setNoteProtocolId(null);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Poznámku se nepodařilo uložit",
        description: e instanceof Error ? e.message : "",
      });
    }
  };

  const uploadFile = async (protocolId: string, files: FileList | null) => {
    if (!files?.length || readOnly) return;
    const storage = getFirebaseStorage();
    if (!storage) return;
    setUploading(true);
    try {
      const newAtts = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const attId = `cust-${Date.now()}-${i}`;
        const path = `companies/${companyId}/handoverProtocols/${protocolId}/attachments/${attId}_${file.name}`;
        const sref = storageRef(storage, path);
        await uploadBytes(sref, file);
        const url = await getDownloadURL(sref);
        newAtts.push({
          id: attId,
          fileName: file.name,
          fileUrl: url,
          storagePath: path,
          mimeType: file.type,
          fileSize: file.size,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
          visibleToCustomer: true,
        });
      }
      await updateDoc(doc(firestore, "companies", companyId, "handoverProtocols", protocolId), {
        attachments: arrayUnion(...newAtts),
        activityHistory: arrayUnion({
          at: new Date().toISOString(),
          action: "customer_attachment",
          byUserId: user.uid,
          detail: newAtts.map((a) => a.fileName).join(", "),
        }),
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Soubor nahrán" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nahrání se nezdařilo",
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setUploading(false);
    }
  };

  if (isLoading) return null;
  if (rows.length === 0) return null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            Předávací protokoly
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.map((row) => {
            const form = handoverProtocolFormFromDoc(row as unknown as Record<string, unknown>);
            const status = row.status ?? "draft";
            return (
              <div key={row.id} className="rounded-lg border p-3 space-y-2 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-semibold">{form.documentTitle}</p>
                  <span className="text-xs text-muted-foreground">
                    {HANDOVER_PROTOCOL_STATUS_LABELS[status] ?? status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {row.protocolNumber} · Předání {form.handoverDateLabel}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPreviewDoc({ ...row, form });
                      setPreviewOpen(true);
                    }}
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" /> Zobrazit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void downloadHandoverProtocolPdf({ user, companyId, protocolId: row.id })
                        .then((blob) => {
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `predavaci-protokol.pdf`;
                          a.click();
                          URL.revokeObjectURL(url);
                        })
                        .catch((e) =>
                          toast({
                            variant: "destructive",
                            title: "PDF",
                            description: e instanceof Error ? e.message : "",
                          })
                        )
                    }
                  >
                    <Download className="h-3.5 w-3.5 mr-1" /> Stáhnout PDF
                  </Button>
                  {!readOnly && status !== "signed_by_customer" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setSignId(row.id)}
                    >
                      <PenLine className="h-3.5 w-3.5 mr-1" /> Podepsat
                    </Button>
                  ) : null}
                </div>
                {!readOnly ? (
                  <div className="border-t pt-2 space-y-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={() =>
                        setNoteProtocolId(noteProtocolId === row.id ? null : row.id)
                      }
                    >
                      Přidat poznámku
                    </Button>
                    {noteProtocolId === row.id ? (
                      <div className="space-y-2">
                        <Textarea
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          placeholder="Vaše poznámka k předání…"
                          className="min-h-[72px]"
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void saveNote(row.id)}
                        >
                          Uložit poznámku
                        </Button>
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                      <Input
                        type="file"
                        multiple
                        className="text-xs"
                        disabled={uploading}
                        onChange={(e) => void uploadFile(row.id, e.target.files)}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <HandoverProtocolPdfPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        protocol={previewDoc}
        companyDoc={companyDoc ?? null}
        user={user}
      />

      {signId ? (
        <HandoverProtocolSignatureDialog
          open={!!signId}
          onOpenChange={(o) => !o && setSignId(null)}
          companyId={companyId}
          protocolId={signId}
          user={user}
          role="customer"
          title="Podpis objednatele"
        />
      ) : null}
    </>
  );
}
