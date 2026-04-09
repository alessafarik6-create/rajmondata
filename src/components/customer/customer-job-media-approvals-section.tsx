"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type Firestore,
  type UpdateData,
} from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import {
  filterFoldersForCustomer,
  isImageCustomerVisible,
  isLegacyPhotoCustomerVisible,
} from "@/lib/job-customer-access";
import type { JobFolderDoc, JobFolderImageDoc } from "@/lib/job-media-types";
import {
  formatMediaDate,
  getJobMediaCustomerDisplayUrl,
  inferJobMediaItemType,
} from "@/lib/job-media-types";
import { CustomerApprovalFullscreenLightbox } from "@/components/customer/customer-approval-fullscreen-lightbox";
import {
  approvalStatusLabelCs,
  isJobMediaAwaitingCustomerApproval,
  jobMediaDocumentRef,
  normalizeCustomerApprovalComment,
  parseJobMediaApproval,
  stripUndefined,
  syncCustomerTaskForMediaApproval,
  type JobMediaRef,
} from "@/lib/job-media-customer-approval";
import { createCustomerActivity } from "@/lib/customer-activity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FileText, Maximize2 } from "lucide-react";

type LegacyPhoto = Record<string, unknown> & { id: string };

export type PendingMediaItem = {
  key: string;
  target: JobMediaRef;
  title: string;
  kind: string;
  previewUrl: string;
  openUrl: string;
  dateLine: string;
  approval: ReturnType<typeof parseJobMediaApproval>;
  raw: Record<string, unknown>;
};

function MediaThumbMini({ row, className }: { row: Record<string, unknown>; className?: string }) {
  const kind = inferJobMediaItemType(row as JobFolderImageDoc);
  const url = getJobMediaCustomerDisplayUrl(row as JobFolderImageDoc);
  if (kind === "pdf") {
    return (
      <div
        className={cn(
          "flex aspect-[4/3] w-full items-center justify-center bg-red-500/10 text-xs font-medium text-red-700",
          className
        )}
      >
        PDF
      </div>
    );
  }
  if (kind === "office") {
    return (
      <div
        className={cn(
          "flex aspect-[4/3] w-full items-center justify-center bg-blue-500/10 text-xs text-blue-800",
          className
        )}
      >
        Soubor
      </div>
    );
  }
  if (!url) {
    return (
      <div
        className={cn(
          "flex aspect-[4/3] w-full items-center justify-center bg-muted text-xs text-muted-foreground",
          className
        )}
      >
        Bez náhledu
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt=""
      className={cn("aspect-[4/3] w-full object-cover", className)}
    />
  );
}

function FolderPendingCollector({
  firestore,
  companyId,
  jobId,
  folder,
  onItems,
}: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  folder: JobFolderDoc;
  onItems: (folderId: string, items: PendingMediaItem[]) => void;
}) {
  const imagesColRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? collection(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId,
            "folders",
            folder.id,
            "images"
          )
        : null,
    [firestore, companyId, jobId, folder.id]
  );
  const { data } = useCollection<JobFolderImageDoc>(imagesColRef);

  useEffect(() => {
    const out: PendingMediaItem[] = [];
    const rows = data ?? [];
    for (const img of rows) {
      if (!img?.id) continue;
      if (!isImageCustomerVisible(folder as Record<string, unknown>, img as Record<string, unknown>))
        continue;
      const row = img as Record<string, unknown>;
      const appr = parseJobMediaApproval(row);
      if (!isJobMediaAwaitingCustomerApproval(appr)) continue;
      const kind = inferJobMediaItemType(img);
      if (kind === "office") continue;
      const title = img.fileName || img.name || img.id;
      const openUrl = getJobMediaCustomerDisplayUrl(img) || "";
      out.push({
        key: `fi_${folder.id}_${img.id}`,
        target: { kind: "folderImages", folderId: folder.id, imageId: img.id },
        title,
        kind: kind === "pdf" ? "PDF" : "Obrázek",
        previewUrl: openUrl,
        openUrl,
        dateLine: formatMediaDate(img.createdAt),
        approval: appr,
        raw: row,
      });
    }
    onItems(folder.id, out);
  }, [data, folder, onItems, jobId]);

  return null;
}

export type CustomerJobMediaApprovalsSectionProps = {
  companyId: string;
  jobId: string;
  customerUid: string;
  legacyPhotos: LegacyPhoto[] | undefined;
};

export function CustomerJobMediaApprovalsSection({
  companyId,
  jobId,
  customerUid,
  legacyPhotos,
}: CustomerJobMediaApprovalsSectionProps) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const { user } = useUser();

  const foldersColRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? collection(firestore, "companies", companyId, "jobs", jobId, "folders")
        : null,
    [firestore, companyId, jobId]
  );
  const { data: foldersRaw } = useCollection<JobFolderDoc>(foldersColRef);
  const customerFolders = useMemo(
    () => filterFoldersForCustomer((foldersRaw ?? []) as JobFolderDoc[]),
    [foldersRaw]
  );

  const [byFolder, setByFolder] = useState<Record<string, PendingMediaItem[]>>({});
  const mergeFolder = useCallback((folderId: string, items: PendingMediaItem[]) => {
    setByFolder((prev) => ({ ...prev, [folderId]: items }));
  }, []);

  const legacyPending = useMemo(() => {
    const out: PendingMediaItem[] = [];
    const list = legacyPhotos ?? [];
    for (const p of list) {
      if (!p?.id) continue;
      if (!isLegacyPhotoCustomerVisible(p)) continue;
      const appr = parseJobMediaApproval(p);
      if (!isJobMediaAwaitingCustomerApproval(appr)) continue;
      const kind = inferJobMediaItemType(p as JobFolderImageDoc);
      if (kind === "office") continue;
      const title = (p.fileName as string) || (p.name as string) || p.id;
      const openUrl = getJobMediaCustomerDisplayUrl(p as JobFolderImageDoc) || "";
      out.push({
        key: `ph_${p.id}`,
        target: { kind: "photos", photoId: p.id },
        title,
        kind: kind === "pdf" ? "PDF" : "Obrázek",
        previewUrl: openUrl,
        openUrl,
        dateLine: formatMediaDate(p.createdAt as unknown),
        approval: appr,
        raw: p,
      });
    }
    return out;
  }, [legacyPhotos]);

  const folderFlat = useMemo(() => Object.values(byFolder).flat(), [byFolder]);

  const allItems = useMemo(() => {
    const m = new Map<string, PendingMediaItem>();
    for (const it of [...folderFlat, ...legacyPending]) {
      m.set(it.key, it);
    }
    return [...m.values()].sort((a, b) => a.title.localeCompare(b.title, "cs"));
  }, [folderFlat, legacyPending]);

  const [lightbox, setLightbox] = useState<PendingMediaItem | null>(null);
  const [commentOpenFor, setCommentOpenFor] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [lightboxCommentOpen, setLightboxCommentOpen] = useState(false);
  const [lightboxCommentDraft, setLightboxCommentDraft] = useState("");

  if (!firestore || !user?.uid) {
    return null;
  }

  const submitApprove = async (it: PendingMediaItem) => {
    setBusyKey(it.key);
    try {
      const ref = jobMediaDocumentRef(firestore, companyId, jobId, it.target);
      await updateDoc(
        ref,
        stripUndefined({
          approvalStatus: "approved",
          approvedAt: serverTimestamp(),
          approvedBy: customerUid,
        }) as unknown as UpdateData<DocumentData>
      );
      await syncCustomerTaskForMediaApproval({
        firestore,
        companyId,
        jobId,
        assignedCustomerUid: customerUid,
        adminUid: user.uid,
        fileLabel: it.title,
        target: it.target,
        enabled: false,
      });
      await createCustomerActivity(firestore, {
        organizationId: companyId,
        jobId,
        customerUserId: customerUid,
        customerId: null,
        type: "customer_media_approval_approved",
        title: "Zákazník schválil dokument",
        message: `${it.title}: schváleno.`,
        createdBy: customerUid,
        createdByRole: "customer",
        isRead: false,
        targetType: "job",
        targetId: it.target.kind === "photos" ? it.target.photoId : it.target.imageId,
        targetLink: `/portal/jobs/${jobId}`,
      });
      toast({ title: "Děkujeme", description: "Souhlas byl uložen." });
      setLightbox(null);
      setLightboxCommentOpen(false);
      setLightboxCommentDraft("");
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Schválení se nepodařilo uložit.",
      });
    } finally {
      setBusyKey(null);
    }
  };

  const submitComment = async (it: PendingMediaItem, textOverride?: string) => {
    const text = normalizeCustomerApprovalComment(textOverride ?? commentDraft);
    if (!text) {
      toast({ variant: "destructive", title: "Zadejte text připomínky." });
      return;
    }
    setBusyKey(it.key);
    try {
      const ref = jobMediaDocumentRef(firestore, companyId, jobId, it.target);
      await updateDoc(
        ref,
        stripUndefined({
          approvalStatus: "changes_requested",
          customerComment: text,
          customerCommentAt: serverTimestamp(),
          customerCommentBy: customerUid,
        }) as unknown as UpdateData<DocumentData>
      );
      await createCustomerActivity(firestore, {
        organizationId: companyId,
        jobId,
        customerUserId: customerUid,
        customerId: null,
        type: "customer_media_changes_requested",
        title: "Připomínka k dokumentu",
        message: `${it.title}: zákazník požádal o úpravu.`,
        createdBy: customerUid,
        createdByRole: "customer",
        isRead: false,
        targetType: "job",
        targetId: it.target.kind === "photos" ? it.target.photoId : it.target.imageId,
        targetLink: `/portal/jobs/${jobId}`,
      });
      toast({ title: "Odesláno", description: "Vaše připomínka byla uložena." });
      setCommentOpenFor(null);
      setCommentDraft("");
      setLightbox(null);
      setLightboxCommentOpen(false);
      setLightboxCommentDraft("");
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Připomínku se nepodařilo odeslat.",
      });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <>
      {customerFolders.map((folder) => (
        <FolderPendingCollector
          key={folder.id}
          firestore={firestore}
          companyId={companyId}
          jobId={jobId}
          folder={folder}
          onItems={mergeFolder}
        />
      ))}
      <Card className="border-amber-200/80 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Ke schválení</CardTitle>
          <p className="text-sm text-muted-foreground">
            Dokumenty k vašemu souhlasu nebo připomínce. Klepněte na náhled pro zvětšení.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {allItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Momentálně zde nejsou žádné obrázky ani výkresy čekající na váš souhlas.
            </p>
          ) : null}
          {allItems.map((it) => (
            <div
              key={it.key}
              className="rounded-xl border bg-card p-3 shadow-sm sm:p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  className="relative w-full shrink-0 overflow-hidden rounded-lg border sm:w-36"
                  onClick={() => setLightbox(it)}
                >
                  <MediaThumbMini row={it.raw} />
                  <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                    <Maximize2 className="mr-0.5 inline h-3 w-3" aria-hidden />
                    větší
                  </span>
                </button>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-foreground">{it.title}</p>
                    <Badge variant="secondary">{it.kind}</Badge>
                    <Badge
                      className={cn(
                        it.approval.approvalStatus === "changes_requested"
                          ? "bg-amber-600 hover:bg-amber-600"
                          : "bg-slate-600 hover:bg-slate-600"
                      )}
                    >
                      {approvalStatusLabelCs(it.approval.approvalStatus)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{it.dateLine}</p>
                  {it.approval.approvalNoteFromAdmin ? (
                    <div className="rounded-md bg-muted/60 px-2.5 py-2 text-sm">
                      <span className="text-xs font-medium text-muted-foreground">Poznámka od firmy: </span>
                      {it.approval.approvalNoteFromAdmin}
                    </div>
                  ) : null}
                  {it.approval.customerComment ? (
                    <div className="rounded-md border border-amber-200/60 bg-amber-50/50 px-2.5 py-2 text-sm dark:border-amber-900/40 dark:bg-amber-950/30">
                      <span className="text-xs font-medium">Vaše připomínka: </span>
                      {it.approval.customerComment}
                    </div>
                  ) : null}
                  {commentOpenFor === it.key ? (
                    <div className="space-y-2">
                      <Textarea
                        value={commentDraft}
                        onChange={(e) => setCommentDraft(e.target.value)}
                        placeholder="Popište, co upravit nebo co vám nevyhovuje…"
                        rows={3}
                        className="min-h-[44px]"
                      />
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-[44px]"
                          onClick={() => {
                            setCommentOpenFor(null);
                            setCommentDraft("");
                          }}
                          disabled={busyKey === it.key}
                        >
                          Zrušit
                        </Button>
                        <Button
                          type="button"
                          className="min-h-[44px]"
                          disabled={
                            busyKey === it.key || !normalizeCustomerApprovalComment(commentDraft)
                          }
                          onClick={() => void submitComment(it)}
                        >
                          Odeslat poznámku
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <Button
                        type="button"
                        className="min-h-[44px] bg-emerald-600 hover:bg-emerald-700"
                        disabled={busyKey === it.key}
                        onClick={() => void submitApprove(it)}
                      >
                        Souhlasím
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-[44px]"
                        disabled={busyKey === it.key}
                        onClick={() => {
                          setCommentOpenFor(it.key);
                          setCommentDraft("");
                        }}
                      >
                        Odeslat poznámku
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-[44px]"
                        onClick={() => setLightbox(it)}
                      >
                        <FileText className="mr-1 h-4 w-4" aria-hidden />
                        Zobrazit větší
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {lightbox ? (
        <CustomerApprovalFullscreenLightbox
          open={!!lightbox}
          onClose={() => {
            setLightbox(null);
            setLightboxCommentOpen(false);
            setLightboxCommentDraft("");
          }}
          title={lightbox.title}
          url={lightbox.openUrl}
          isPdf={inferJobMediaItemType(lightbox.raw as JobFolderImageDoc) === "pdf"}
          footer={
            <div className="space-y-3 text-foreground">
              {!lightbox.openUrl ? (
                <p className="text-sm text-white/70">Náhled není k dispozici.</p>
              ) : null}
              {lightbox.approval.approvalNoteFromAdmin ? (
                <p className="text-sm text-white/85">
                  <span className="font-medium text-white">Poznámka od firmy: </span>
                  {lightbox.approval.approvalNoteFromAdmin}
                </p>
              ) : null}
              {lightboxCommentOpen ? (
                <div className="space-y-2">
                  <Textarea
                    value={lightboxCommentDraft}
                    onChange={(e) => setLightboxCommentDraft(e.target.value)}
                    placeholder="Popište požadavek na opravu…"
                    rows={3}
                    className="min-h-[44px] border-white/20 bg-white/10 text-white placeholder:text-white/45"
                  />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-[44px] border-white/30 bg-transparent text-white hover:bg-white/10"
                      disabled={busyKey === lightbox.key}
                      onClick={() => {
                        setLightboxCommentOpen(false);
                        setLightboxCommentDraft("");
                      }}
                    >
                      Zrušit
                    </Button>
                    <Button
                      type="button"
                      className="min-h-[44px]"
                      disabled={
                        busyKey === lightbox.key ||
                        !normalizeCustomerApprovalComment(lightboxCommentDraft)
                      }
                      onClick={() => void submitComment(lightbox, lightboxCommentDraft)}
                    >
                      Odeslat poznámku
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button
                    type="button"
                    className="min-h-[44px] bg-emerald-600 hover:bg-emerald-700"
                    disabled={busyKey === lightbox.key}
                    onClick={() => void submitApprove(lightbox)}
                  >
                    Souhlasím
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[44px] border-white/30 bg-transparent text-white hover:bg-white/10"
                    disabled={busyKey === lightbox.key}
                    onClick={() => {
                      setLightboxCommentOpen(true);
                      setLightboxCommentDraft("");
                    }}
                  >
                    Požadavek na opravu
                  </Button>
                </div>
              )}
            </div>
          }
        />
      ) : null}
    </>
  );
}
