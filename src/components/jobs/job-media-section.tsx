"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import type { Firestore } from "firebase/firestore";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import type { User } from "firebase/auth";
import {
  useCollection,
  useFirestore,
  useMemoFirebase,
} from "@/firebase";
import { getFirebaseStorage } from "@/firebase/storage";
import {
  uploadJobFolderImageFileViaFirebaseSdk,
} from "@/lib/job-photo-upload";
import {
  formatMediaDate,
  getJobMediaPreviewUrl,
  inferJobMediaItemType,
  isAllowedJobImageFile,
  isAllowedJobMediaFile,
  getJobMediaFileTypeFromFile,
  JOB_IMAGE_ACCEPT_ATTR,
  JOB_MEDIA_ACCEPT_ATTR,
  type JobFolderDoc,
  type JobFolderImageDoc,
  type JobMediaFirestorePath,
  type JobPhotoAnnotationTarget,
} from "@/lib/job-media-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Camera,
  Download,
  ExternalLink,
  Eye,
  FileText,
  FolderPlus,
  ImagePlus,
  Pencil,
  StickyNote,
  Trash2,
  Upload,
} from "lucide-react";

const MAX_BYTES = 20 * 1024 * 1024;

/** Mřížka karet: mobil 2 sloupce, desktop více sloupců */
const JOB_MEDIA_CARD_GRID_CLASS =
  "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5";

const jobMediaIconBtnClassName =
  "h-10 w-10 min-h-10 min-w-10 shrink-0 gap-0 rounded-md border-border/70 bg-background/95 p-0 shadow-sm hover:bg-accent md:h-9 md:w-9 md:min-h-9 md:min-w-9 [&_svg]:!size-[18px]";

function JobMediaIconButton({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(jobMediaIconBtnClassName, className)}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[220px] text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

type LegacyPhotoDoc = {
  id: string;
  fileName?: string;
  name?: string;
  fileType?: "image" | "pdf";
  imageUrl?: string;
  url?: string;
  downloadURL?: string;
  originalImageUrl?: string;
  annotatedImageUrl?: string;
  storagePath?: string;
  path?: string;
  fullPath?: string;
  annotationData?: unknown;
  note?: string;
  noteUpdatedAt?: unknown;
  noteUpdatedBy?: string;
  createdAt?: unknown;
  createdBy?: string;
};

function MediaThumb({
  row,
  alt,
}: {
  row: { id: string; fileName?: string; name?: string };
  alt?: string;
}) {
  const [broken, setBroken] = useState(false);
  const src = getJobMediaPreviewUrl(row as Parameters<typeof getJobMediaPreviewUrl>[0]);

  if (!src || broken) {
    return (
      <div className="flex h-36 w-full items-center justify-center bg-muted px-2 text-center text-xs text-muted-foreground sm:h-40">
        {!src ? "Chybí náhled" : "Nelze načíst obrázek"}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || row.fileName || row.id}
      className="h-36 w-full object-cover sm:h-40"
      onError={() => setBroken(true)}
    />
  );
}

function JobMediaPdfPreview() {
  return (
    <div
      className="flex h-36 w-full flex-col items-center justify-center gap-1.5 bg-red-500/[0.07] sm:h-40"
      aria-hidden
    >
      <span className="text-2xl leading-none">📄</span>
      <FileText className="h-9 w-9 text-red-600 dark:text-red-400" strokeWidth={1.5} />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        PDF
      </span>
    </div>
  );
}

function JobMediaFileCard({
  borderClassName,
  preview,
  title,
  dateLine,
  note,
  hasNote,
  actions,
}: {
  borderClassName?: string;
  preview: React.ReactNode;
  title: string;
  dateLine: string;
  note?: string;
  hasNote: boolean;
  actions: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm",
        "transition-[box-shadow,border-color,transform] duration-200",
        "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
        borderClassName
      )}
    >
      <div className="relative w-full shrink-0 overflow-hidden bg-muted">
        {preview}
        {hasNote ? (
          <span
            className="absolute right-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] leading-none text-white"
            title="Má poznámku"
          >
            📝
          </span>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-2.5 pt-2">
        <p
          className="truncate text-sm font-medium leading-tight text-foreground"
          title={title}
        >
          {title}
        </p>
        <p className="text-xs text-muted-foreground">{dateLine}</p>
        {note?.trim() ? (
          <p className="line-clamp-2 text-[11px] leading-snug text-foreground/88">
            {note.trim()}
          </p>
        ) : null}
        <div className="mt-auto flex flex-nowrap items-center justify-center gap-1 overflow-x-auto border-t border-border/45 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {actions}
        </div>
      </div>
    </div>
  );
}

function UserFolderBlock({
  folder,
  companyId,
  jobId,
  firestore,
  user,
  canManageFolders,
  onAnnotatePhoto,
  onNoteDialogOpen,
}: {
  folder: JobFolderDoc;
  companyId: string;
  jobId: string;
  firestore: Firestore;
  user: User;
  canManageFolders: boolean;
  onAnnotatePhoto: (t: JobPhotoAnnotationTarget) => void;
  onNoteDialogOpen: (ctx: {
    path: JobMediaFirestorePath;
    imageId: string;
    currentNote: string;
  }) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [imagePreview, setImagePreview] = useState<{
    url: string;
    title: string;
  } | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const imagesColRef = useMemoFirebase(
    () =>
      collection(
        firestore,
        "companies",
        companyId,
        "jobs",
        jobId,
        "folders",
        folder.id,
        "images"
      ),
    [firestore, companyId, jobId, folder.id]
  );
  const { data: imagesRaw } = useCollection<JobFolderImageDoc>(imagesColRef);

  const images = useMemo(() => {
    const list = (imagesRaw || []) as JobFolderImageDoc[];
    return list
      .filter((x) => x && typeof x.id === "string")
      .slice()
      .sort((a, b) => {
        const ta =
          typeof (a.createdAt as { toMillis?: () => number })?.toMillis ===
          "function"
            ? (a.createdAt as { toMillis: () => number }).toMillis()
            : 0;
        const tb =
          typeof (b.createdAt as { toMillis?: () => number })?.toMillis ===
          "function"
            ? (b.createdAt as { toMillis: () => number }).toMillis()
            : 0;
        return tb - ta;
      });
  }, [imagesRaw]);

  const uploadOne = async (file: File) => {
    if (!isAllowedJobMediaFile(file)) {
      toast({
        variant: "destructive",
        title: "Nepodporovaný formát",
        description: "Pouze JPG, PNG, WEBP nebo PDF.",
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({
        variant: "destructive",
        title: "Soubor je příliš velký",
        description: "Maximální velikost je 20 MB.",
      });
      return;
    }

    const safeBaseName =
      file.name.replace(/^.*[\\/]/, "").replace(/\s+/g, " ").trim() || "photo";
    const fileType = getJobMediaFileTypeFromFile(file);

    const { resolvedFullPath, downloadURL } =
      await uploadJobFolderImageFileViaFirebaseSdk(
        file,
        companyId,
        jobId,
        folder.id
      );

    const refDoc = doc(imagesColRef);
    await setDoc(
      refDoc,
      {
        id: refDoc.id,
        companyId,
        jobId,
        folderId: folder.id,
        imageUrl: downloadURL,
        url: downloadURL,
        originalImageUrl: downloadURL,
        downloadURL,
        fileType,
        storagePath: resolvedFullPath,
        path: resolvedFullPath,
        fileName: safeBaseName,
        name: safeBaseName,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      }
    );

    toast({ title: "Soubor uložen", description: safeBaseName });
  };

  const deleteImage = async (img: JobFolderImageDoc) => {
    if (
      !window.confirm(
        `Smazat soubor „${img.fileName || img.id}“? Tato akce je nevratná.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const sp =
        (typeof img.storagePath === "string" && img.storagePath) ||
        (typeof img.path === "string" && img.path) ||
        "";
      if (sp) {
        try {
          await deleteObject(ref(getFirebaseStorage(), sp));
        } catch {
          /* může být již smazáno */
        }
      }
      if (img.annotatedStoragePath) {
        try {
          await deleteObject(ref(getFirebaseStorage(), img.annotatedStoragePath));
        } catch {
          /* ignore */
        }
      }
      await deleteDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId,
          "folders",
          folder.id,
          "images",
          img.id
        )
      );
      toast({ title: "Soubor smazán" });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Soubor se nepodařilo smazat.",
      });
    } finally {
      setBusy(false);
    }
  };

  const deleteFolder = async () => {
    if (
      !window.confirm(
        `Smazat složku „${folder.name || folder.id}“ včetně všech souborů?`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const snap = await getDocs(imagesColRef);
      for (const d of snap.docs) {
        const data = d.data() as JobFolderImageDoc;
        const sp =
          (typeof data.storagePath === "string" && data.storagePath) ||
          (typeof data.path === "string" && data.path) ||
          "";
        if (sp) {
          try {
            await deleteObject(ref(getFirebaseStorage(), sp));
          } catch {
            /* */
          }
        }
        if (data.annotatedStoragePath) {
          try {
            await deleteObject(
              ref(getFirebaseStorage(), data.annotatedStoragePath)
            );
          } catch {
            /* */
          }
        }
        await deleteDoc(d.ref);
      }
      await deleteDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId,
          "folders",
          folder.id
        )
      );
      toast({ title: "Složka byla odstraněna" });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Složku se nepodařilo smazat.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Card className="border-border/60 bg-surface">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base font-semibold">
          {folder.name || "Bez názvu"}
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          {canManageFolders ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="min-h-[40px] min-w-[44px]"
              disabled={busy}
              onClick={() => void deleteFolder()}
            >
              <Trash2 className="h-4 w-4" />
              <span className="ml-1 hidden sm:inline">Složku</span>
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            ref={galleryRef}
            type="file"
            accept={JOB_MEDIA_ACCEPT_ATTR}
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []).filter(Boolean);
              e.target.value = "";
              if (!files.length) return;
              setBusy(true);
              void (async () => {
                for (const f of files) {
                  try {
                    await uploadOne(f);
                  } catch (err) {
                    console.error(err);
                    toast({
                      variant: "destructive",
                      title: "Nahrání selhalo",
                      description: f.name,
                    });
                  }
                }
              })().finally(() => setBusy(false));
            }}
          />
          <Button
            type="button"
            variant="default"
            className="min-h-[44px] flex-1 gap-2"
            disabled={busy}
            onClick={() => galleryRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            Nahrát soubor
          </Button>
          <input
            ref={cameraRef}
            type="file"
            accept={JOB_IMAGE_ACCEPT_ATTR}
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              void uploadOne(file).catch((err) => {
                console.error(err);
                toast({
                  variant: "destructive",
                  title: "Fotka se nepodařila uložit",
                });
              }).finally(() => setBusy(false));
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] flex-1 gap-2"
            disabled={busy}
            onClick={() => cameraRef.current?.click()}
          >
            <Camera className="h-4 w-4" />
            Vyfotit
          </Button>
        </div>

        {images.length > 0 ? (
          <div className={JOB_MEDIA_CARD_GRID_CLASS}>
            {images.map((img) => {
              const kind = inferJobMediaItemType(img);
              const openUrl = getJobMediaPreviewUrl(img);
              const title = img.fileName || img.name || img.id;
              const dateLine =
                kind === "pdf"
                  ? `PDF · ${formatMediaDate(img.createdAt)}`
                  : formatMediaDate(img.createdAt);
              const hasNote = !!img.note?.trim();

              if (kind === "pdf") {
                return (
                  <JobMediaFileCard
                    key={img.id}
                    borderClassName="border-dashed border-red-500/30"
                    preview={<JobMediaPdfPreview />}
                    title={title}
                    dateLine={dateLine}
                    note={img.note}
                    hasNote={hasNote}
                    actions={
                      <>
                        <JobMediaIconButton
                          label="Otevřít v novém okně"
                          disabled={!openUrl}
                          onClick={() => {
                            if (openUrl)
                              window.open(
                                openUrl,
                                "_blank",
                                "noopener,noreferrer"
                              );
                          }}
                        >
                          <ExternalLink className="size-[18px]" aria-hidden />
                        </JobMediaIconButton>
                        {openUrl ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                className={jobMediaIconBtnClassName}
                                asChild
                              >
                                <a
                                  href={openUrl}
                                  download={title}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Download className="size-[18px]" aria-hidden />
                                </a>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">
                              Stáhnout
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <JobMediaIconButton label="Stáhnout" disabled>
                            <Download className="size-[18px]" aria-hidden />
                          </JobMediaIconButton>
                        )}
                        <JobMediaIconButton
                          label="Poznámka"
                          onClick={() =>
                            onNoteDialogOpen({
                              path: {
                                kind: "folderImages",
                                folderId: folder.id,
                              },
                              imageId: img.id,
                              currentNote: img.note || "",
                            })
                          }
                        >
                          <StickyNote className="size-[18px]" aria-hidden />
                        </JobMediaIconButton>
                        <JobMediaIconButton
                          label="Smazat soubor"
                          disabled={busy}
                          className="border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void deleteImage(img)}
                        >
                          <Trash2 className="size-[18px]" aria-hidden />
                        </JobMediaIconButton>
                      </>
                    }
                  />
                );
              }

              return (
                <JobMediaFileCard
                  key={img.id}
                  borderClassName="border-border/55"
                  preview={<MediaThumb row={img} alt={title} />}
                  title={title}
                  dateLine={dateLine}
                  note={img.note}
                  hasNote={hasNote}
                  actions={
                    <>
                      <JobMediaIconButton
                        label="Náhled"
                        disabled={!openUrl}
                        onClick={() => {
                          if (openUrl)
                            setImagePreview({ url: openUrl, title });
                        }}
                      >
                        <Eye className="size-[18px]" aria-hidden />
                      </JobMediaIconButton>
                      <JobMediaIconButton
                        label="Anotovat"
                        onClick={() =>
                          onAnnotatePhoto({
                            id: img.id,
                            imageUrl: img.imageUrl,
                            url: img.url,
                            downloadURL: img.downloadURL,
                            originalImageUrl: img.originalImageUrl,
                            annotatedImageUrl: img.annotatedImageUrl,
                            storagePath: img.storagePath,
                            path: img.path,
                            annotatedStoragePath: img.annotatedStoragePath,
                            fileName: img.fileName,
                            name: img.name,
                            annotationData: img.annotationData,
                            annotationTarget: {
                              kind: "folderImages",
                              folderId: folder.id,
                            },
                          })
                        }
                      >
                        <Pencil className="size-[18px]" aria-hidden />
                      </JobMediaIconButton>
                      {openUrl ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              className={jobMediaIconBtnClassName}
                              asChild
                            >
                              <a
                                href={openUrl}
                                download={title}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <Download className="size-[18px]" aria-hidden />
                              </a>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">
                            Stáhnout
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <JobMediaIconButton label="Stáhnout" disabled>
                          <Download className="size-[18px]" aria-hidden />
                        </JobMediaIconButton>
                      )}
                      <JobMediaIconButton
                        label="Poznámka"
                        onClick={() =>
                          onNoteDialogOpen({
                            path: {
                              kind: "folderImages",
                              folderId: folder.id,
                            },
                            imageId: img.id,
                            currentNote: img.note || "",
                          })
                        }
                      >
                        <StickyNote className="size-[18px]" aria-hidden />
                      </JobMediaIconButton>
                      <JobMediaIconButton
                        label="Smazat soubor"
                        disabled={busy}
                        className="border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => void deleteImage(img)}
                      >
                        <Trash2 className="size-[18px]" aria-hidden />
                      </JobMediaIconButton>
                    </>
                  }
                />
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">V této složce zatím nic není.</p>
        )}
      </CardContent>
    </Card>

    <Dialog
      open={!!imagePreview}
      onOpenChange={(o) => {
        if (!o) setImagePreview(null);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-auto">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">
            {imagePreview?.title || "Náhled"}
          </DialogTitle>
        </DialogHeader>
        {imagePreview?.url ? (
          <img
            src={imagePreview.url}
            alt={imagePreview.title}
            className="mx-auto max-h-[70vh] w-auto max-w-full object-contain"
          />
        ) : null}
      </DialogContent>
    </Dialog>
    </>
  );
}

export type JobMediaSectionProps = {
  companyId: string;
  jobId: string;
  user: User | null;
  canManageFolders: boolean;
  /** Legacy fotodokumentace (kolekce photos). */
  photos: LegacyPhotoDoc[] | undefined;
  uploadLegacyPhoto: (
    file: File,
    opts?: { skipUploadingFlag?: boolean }
  ) => Promise<void>;
  legacyUploading: boolean;
  onAnnotatePhoto: (target: JobPhotoAnnotationTarget) => void;
};

export function JobMediaSection({
  companyId,
  jobId,
  user,
  canManageFolders,
  photos,
  uploadLegacyPhoto,
  legacyUploading,
  onAnnotatePhoto,
}: JobMediaSectionProps) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteCtx, setNoteCtx] = useState<{
    path: JobMediaFirestorePath;
    imageId: string;
  } | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);

  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [legacyImagePreview, setLegacyImagePreview] = useState<{
    url: string;
    title: string;
  } | null>(null);

  const foldersColRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? collection(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId,
            "folders"
          )
        : null,
    [firestore, companyId, jobId]
  );

  const { data: foldersRaw } = useCollection<JobFolderDoc>(foldersColRef);

  const foldersSorted = useMemo(() => {
    const list = (foldersRaw || []).filter(
      (f) => f && typeof f.id === "string"
    ) as JobFolderDoc[];
    return list.slice().sort((a, b) => {
      const na = (a.name || "").toLowerCase();
      const nb = (b.name || "").toLowerCase();
      return na.localeCompare(nb, "cs");
    });
  }, [foldersRaw]);

  const openNoteEditor = useCallback(
    (ctx: { path: JobMediaFirestorePath; imageId: string; currentNote: string }) => {
      setNoteCtx({ path: ctx.path, imageId: ctx.imageId });
      setNoteDraft(ctx.currentNote);
      setNoteOpen(true);
    },
    []
  );

  const saveNote = async () => {
    if (!firestore || !user || !noteCtx) return;
    const text = noteDraft.trim();
    setNoteSaving(true);
    try {
      if (noteCtx.path.kind === "photos") {
        await updateDoc(
          doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId,
            "photos",
            noteCtx.imageId
          ),
          text
            ? {
                note: text,
                noteUpdatedAt: serverTimestamp(),
                noteUpdatedBy: user.uid,
              }
            : {
                note: deleteField(),
                noteUpdatedAt: serverTimestamp(),
                noteUpdatedBy: user.uid,
              }
        );
      } else {
        await updateDoc(
          doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId,
            "folders",
            noteCtx.path.folderId,
            "images",
            noteCtx.imageId
          ),
          text
            ? {
                note: text,
                noteUpdatedAt: serverTimestamp(),
                noteUpdatedBy: user.uid,
              }
            : {
                note: deleteField(),
                noteUpdatedAt: serverTimestamp(),
                noteUpdatedBy: user.uid,
              }
        );
      }
      toast({ title: text ? "Poznámka uložena" : "Poznámka odstraněna" });
      setNoteOpen(false);
      setNoteCtx(null);
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Poznámku se nepodařilo uložit.",
      });
    } finally {
      setNoteSaving(false);
    }
  };

  const deleteLegacyPhoto = async (p: LegacyPhotoDoc) => {
    if (!firestore) return;
    if (
      !window.confirm(
        `Smazat soubor „${p.fileName || p.id}“? Tato akce je nevratná.`
      )
    ) {
      return;
    }
    try {
      const sp =
        (typeof p.storagePath === "string" && p.storagePath) ||
        (typeof p.path === "string" && p.path) ||
        "";
      if (sp) {
        try {
          await deleteObject(ref(getFirebaseStorage(), sp));
        } catch {
          /* */
        }
      }
      if ((p as { annotatedStoragePath?: string }).annotatedStoragePath) {
        try {
          await deleteObject(
            ref(
              getFirebaseStorage(),
              (p as { annotatedStoragePath?: string }).annotatedStoragePath!
            )
          );
        } catch {
          /* */
        }
      }
      await deleteDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId,
          "photos",
          p.id
        )
      );
      toast({ title: "Soubor smazán" });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Soubor se nepodařilo smazat.",
      });
    }
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!firestore || !user || !name) {
      toast({
        variant: "destructive",
        title: "Zadejte název složky",
      });
      return;
    }
    if (!canManageFolders) {
      toast({
        variant: "destructive",
        title: "Nemáte oprávnění",
        description: "Vytvářet složky mohou jen správci.",
      });
      return;
    }
    setCreatingFolder(true);
    try {
      const refDoc = doc(
        collection(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId,
          "folders"
        )
      );
      await setDoc(refDoc, {
        id: refDoc.id,
        name,
        companyId,
        jobId,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      });
      setNewFolderName("");
      setNewFolderOpen(false);
      toast({ title: "Složka vytvořena", description: name });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Složku se nepodařilo vytvořit.",
      });
    } finally {
      setCreatingFolder(false);
    }
  };

  const photosSorted = useMemo(() => {
    const list = (photos || []).filter((p) => p?.id);
    return list.slice().sort((a, b) => {
      const ta =
        typeof (a.createdAt as { toMillis?: () => number })?.toMillis ===
        "function"
          ? (a.createdAt as { toMillis: () => number }).toMillis()
          : 0;
      const tb =
        typeof (b.createdAt as { toMillis?: () => number })?.toMillis ===
        "function"
          ? (b.createdAt as { toMillis: () => number }).toMillis()
          : 0;
      return tb - ta;
    });
  }, [photos]);

  if (!firestore || !user) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Pro práci s fotkami se přihlaste.
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider delayDuration={250}>
      <>
      <Card className="bg-surface border-border">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
            <ImagePlus className="h-5 w-5 shrink-0 text-primary" />
            Fotodokumentace a složky
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {canManageFolders ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] gap-2"
                onClick={() => setNewFolderOpen(true)}
              >
                <FolderPlus className="h-4 w-4" />
                Nová složka
              </Button>
            ) : null}
          </div>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">
              Fotodokumentace
            </h3>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                ref={galleryRef}
                type="file"
                accept={JOB_MEDIA_ACCEPT_ATTR}
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []).filter(
                    (f) => f && f.size > 0
                  );
                  e.target.value = "";
                  if (!files.length) {
                    toast({
                      variant: "destructive",
                      title: "Žádný soubor",
                    });
                    return;
                  }
                  void (async () => {
                    for (const f of files) {
                      if (!isAllowedJobMediaFile(f)) {
                        toast({
                          variant: "destructive",
                          title: "Přeskočeno",
                          description: `${f.name} — pouze JPG, PNG, WEBP nebo PDF.`,
                        });
                        continue;
                      }
                      try {
                        await uploadLegacyPhoto(f, {
                          skipUploadingFlag: true,
                        });
                      } catch (err) {
                        console.error(err);
                      }
                    }
                  })();
                }}
              />
              <Button
                type="button"
                className="min-h-[44px] flex-1 gap-2"
                disabled={legacyUploading}
                onClick={() => galleryRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                Nahrát soubor
              </Button>
              <input
                ref={cameraRef}
                type="file"
                accept={JOB_IMAGE_ACCEPT_ATTR}
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) {
                    toast({
                      variant: "destructive",
                      title: "Nebyla pořízena fotografie",
                    });
                    return;
                  }
                  if (!isAllowedJobImageFile(file)) {
                    toast({
                      variant: "destructive",
                      title: "Nepodporovaný formát",
                    });
                    return;
                  }
                  void uploadLegacyPhoto(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] flex-1 gap-2"
                disabled={legacyUploading}
                onClick={() => cameraRef.current?.click()}
              >
                <Camera className="h-4 w-4" />
                Vyfotit
              </Button>
            </div>
            {legacyUploading ? (
              <p className="text-sm text-muted-foreground">Nahrávání…</p>
            ) : null}

            {photosSorted.length > 0 ? (
              <div className={JOB_MEDIA_CARD_GRID_CLASS}>
                {photosSorted.map((p) => {
                  const kind = inferJobMediaItemType(p);
                  const openUrl = getJobMediaPreviewUrl(p);
                  const title = p.fileName || p.name || p.id;
                  const dateLine =
                    kind === "pdf"
                      ? `PDF · ${formatMediaDate(p.createdAt)}`
                      : formatMediaDate(p.createdAt);
                  const hasNote = !!p.note?.trim();

                  if (kind === "pdf") {
                    return (
                      <JobMediaFileCard
                        key={p.id}
                        borderClassName="border-dashed border-red-500/30"
                        preview={<JobMediaPdfPreview />}
                        title={title}
                        dateLine={dateLine}
                        note={p.note}
                        hasNote={hasNote}
                        actions={
                          <>
                            <JobMediaIconButton
                              label="Otevřít v novém okně"
                              disabled={!openUrl}
                              onClick={() => {
                                if (openUrl)
                                  window.open(
                                    openUrl,
                                    "_blank",
                                    "noopener,noreferrer"
                                  );
                              }}
                            >
                              <ExternalLink className="size-[18px]" aria-hidden />
                            </JobMediaIconButton>
                            {openUrl ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    className={jobMediaIconBtnClassName}
                                    asChild
                                  >
                                    <a
                                      href={openUrl}
                                      download={title}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <Download className="size-[18px]" aria-hidden />
                                    </a>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-xs">
                                  Stáhnout
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <JobMediaIconButton label="Stáhnout" disabled>
                                <Download className="size-[18px]" aria-hidden />
                              </JobMediaIconButton>
                            )}
                            <JobMediaIconButton
                              label="Poznámka"
                              onClick={() =>
                                openNoteEditor({
                                  path: { kind: "photos" },
                                  imageId: p.id,
                                  currentNote: p.note || "",
                                })
                              }
                            >
                              <StickyNote className="size-[18px]" aria-hidden />
                            </JobMediaIconButton>
                            <JobMediaIconButton
                              label="Smazat soubor"
                              className="border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void deleteLegacyPhoto(p)}
                            >
                              <Trash2 className="size-[18px]" aria-hidden />
                            </JobMediaIconButton>
                          </>
                        }
                      />
                    );
                  }

                  return (
                    <JobMediaFileCard
                      key={p.id}
                      borderClassName="border-border/55"
                      preview={<MediaThumb row={p} alt={title} />}
                      title={title}
                      dateLine={dateLine}
                      note={p.note}
                      hasNote={hasNote}
                      actions={
                        <>
                          <JobMediaIconButton
                            label="Náhled"
                            disabled={!openUrl}
                            onClick={() => {
                              if (openUrl)
                                setLegacyImagePreview({ url: openUrl, title });
                            }}
                          >
                            <Eye className="size-[18px]" aria-hidden />
                          </JobMediaIconButton>
                          <JobMediaIconButton
                            label="Anotovat"
                            onClick={() =>
                              onAnnotatePhoto({
                                id: p.id,
                                imageUrl: p.imageUrl,
                                url: p.url,
                                downloadURL: p.downloadURL,
                                originalImageUrl: p.originalImageUrl,
                                annotatedImageUrl: p.annotatedImageUrl,
                                storagePath: p.storagePath,
                                path: p.path,
                                fullPath: p.fullPath,
                                fileName: p.fileName,
                                name: p.name,
                                annotationData: p.annotationData,
                                annotationTarget: { kind: "photos" },
                              })
                            }
                          >
                            <Pencil className="size-[18px]" aria-hidden />
                          </JobMediaIconButton>
                          {openUrl ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className={jobMediaIconBtnClassName}
                                  asChild
                                >
                                  <a
                                    href={openUrl}
                                    download={title}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <Download className="size-[18px]" aria-hidden />
                                  </a>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="text-xs">
                                Stáhnout
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <JobMediaIconButton label="Stáhnout" disabled>
                              <Download className="size-[18px]" aria-hidden />
                            </JobMediaIconButton>
                          )}
                          <JobMediaIconButton
                            label="Poznámka"
                            onClick={() =>
                              openNoteEditor({
                                path: { kind: "photos" },
                                imageId: p.id,
                                currentNote: p.note || "",
                              })
                            }
                          >
                            <StickyNote className="size-[18px]" aria-hidden />
                          </JobMediaIconButton>
                          <JobMediaIconButton
                            label="Smazat soubor"
                            className="border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => void deleteLegacyPhoto(p)}
                          >
                            <Trash2 className="size-[18px]" aria-hidden />
                          </JobMediaIconButton>
                        </>
                      }
                    />
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Zatím žádné soubory ve fotodokumentaci.
              </p>
            )}
          </section>

          {foldersSorted.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                Vlastní složky
              </h3>
              <div className="space-y-4">
                {foldersSorted.map((folder) => (
                  <UserFolderBlock
                    key={folder.id}
                    folder={folder}
                    companyId={companyId}
                    jobId={jobId}
                    firestore={firestore}
                    user={user}
                    canManageFolders={canManageFolders}
                    onAnnotatePhoto={onAnnotatePhoto}
                    onNoteDialogOpen={openNoteEditor}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nová složka</DialogTitle>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Název složky"
            className="min-h-[44px]"
            maxLength={120}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setNewFolderOpen(false)}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              disabled={creatingFolder || !newFolderName.trim()}
              onClick={() => void createFolder()}
            >
              Vytvořit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Poznámka k souboru</DialogTitle>
          </DialogHeader>
          <Textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Text poznámky…"
            rows={5}
            className="min-h-[120px]"
          />
          <DialogFooter className="flex flex-wrap gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setNoteDraft("");
              }}
            >
              Vymazat text
            </Button>
            <Button type="button" variant="outline" onClick={() => setNoteOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" disabled={noteSaving} onClick={() => void saveNote()}>
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!legacyImagePreview}
        onOpenChange={(o) => {
          if (!o) setLegacyImagePreview(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-auto">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">
              {legacyImagePreview?.title || "Náhled"}
            </DialogTitle>
          </DialogHeader>
          {legacyImagePreview?.url ? (
            <img
              src={legacyImagePreview.url}
              alt={legacyImagePreview.title}
              className="mx-auto max-h-[70vh] w-auto max-w-full object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
      </>
    </TooltipProvider>
  );
}
