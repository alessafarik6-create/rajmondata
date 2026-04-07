"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentData, DocumentReference } from "firebase/firestore";
import { serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";
import { deleteObject, ref } from "firebase/storage";
import { getFirebaseStorage } from "@/firebase/storage";
import { uploadCustomerProgressImageFileViaFirebaseSdk } from "@/lib/job-photo-upload";
import { isAllowedJobImageFile } from "@/lib/job-media-types";
import {
  type CustomerProgressImage,
  newCustomerProgressImageId,
  normalizeCompletionPercent,
  parseCustomerProgressImages,
} from "@/lib/job-customer-progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, Trash2, ChevronUp, ChevronDown, Upload } from "lucide-react";
import { JD } from "@/lib/job-detail-page-styles";

function stableImagesFingerprint(raw: unknown): string {
  if (!Array.isArray(raw)) return "[]";
  try {
    return JSON.stringify(
      raw.map((x) =>
        x && typeof x === "object"
          ? {
              id: (x as { id?: string }).id,
              url: (x as { url?: string }).url,
              o: (x as { order?: number }).order,
              v: (x as { visibleToCustomer?: boolean }).visibleToCustomer,
            }
          : null
      )
    );
  } catch {
    return String(raw);
  }
}

function serializeForFirestore(images: CustomerProgressImage[]): DocumentData[] {
  return images.map((img, order): DocumentData => {
    const row: DocumentData = {
      id: img.id,
      url: img.url,
      storagePath: img.storagePath,
      order,
      title: img.title?.trim() ?? "",
      description: img.description?.trim() ?? "",
      visibleToCustomer: img.visibleToCustomer !== false,
    };
    /** Nelze použít serverTimestamp() uvnitř prvku pole — jen konkrétní Timestamp / číslo. */
    if (img.createdAt !== undefined && img.createdAt !== null) {
      row.createdAt = img.createdAt;
    } else {
      row.createdAt = Timestamp.now();
    }
    return row;
  });
}

type Props = {
  companyId: string;
  jobId: string;
  jobRef: DocumentReference | null;
  job: Record<string, unknown> | null | undefined;
  canEdit: boolean;
};

export function JobCustomerProgressAdminSection({
  companyId,
  jobId,
  jobRef,
  job,
  canEdit,
}: Props) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<CustomerProgressImage[]>([]);
  const [completion, setCompletion] = useState(0);
  const [images, setImages] = useState<CustomerProgressImage[]>([]);
  const [imagesExpanded, setImagesExpanded] = useState(false);
  imagesRef.current = images;
  const [uploading, setUploading] = useState(false);
  const [savingPercent, setSavingPercent] = useState(false);
  const [savingImages, setSavingImages] = useState(false);

  const fp = stableImagesFingerprint(job?.customerProgressImages);
  const remotePercent = normalizeCompletionPercent(job?.completionPercent);

  useEffect(() => {
    setCompletion(remotePercent);
  }, [remotePercent]);

  useEffect(() => {
    setImages(parseCustomerProgressImages(job?.customerProgressImages));
  }, [fp, jobId]);

  const persistImages = useCallback(
    async (next: CustomerProgressImage[]) => {
      if (!jobRef || !canEdit) return;
      setSavingImages(true);
      try {
        await updateDoc(jobRef, {
          customerProgressImages: serializeForFirestore(next),
          updatedAt: serverTimestamp(),
        });
        setImages(next);
      } catch (e) {
        console.error(e);
        toast({
          variant: "destructive",
          title: "Uložení se nezdařilo",
          description: e instanceof Error ? e.message : "Zkuste to znovu.",
        });
      } finally {
        setSavingImages(false);
      }
    },
    [jobRef, canEdit, toast]
  );

  const handleSavePercent = async () => {
    if (!jobRef || !canEdit) return;
    setSavingPercent(true);
    try {
      await updateDoc(jobRef, {
        completionPercent: normalizeCompletionPercent(completion),
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Uloženo", description: "Procento dokončení bylo aktualizováno." });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Uložení se nezdařilo.",
      });
    } finally {
      setSavingPercent(false);
    }
  };

  const handlePickFiles = async (files: FileList | null) => {
    if (!files?.length || !canEdit || !jobRef) return;
    const list = Array.from(files).filter((f) => isAllowedJobImageFile(f));
    if (!list.length) {
      toast({
        variant: "destructive",
        title: "Nepodporovaný soubor",
        description: "Nahrajte obrázek (JPG, PNG, WebP, …).",
      });
      return;
    }
    setUploading(true);
    let next = [...images];
    try {
      for (const file of list) {
        const { downloadURL, storagePath } = await uploadCustomerProgressImageFileViaFirebaseSdk(
          file,
          companyId,
          jobId
        );
        const id = newCustomerProgressImageId();
        next.push({
          id,
          url: downloadURL,
          storagePath,
          order: next.length,
          visibleToCustomer: true,
        });
      }
      await persistImages(next);
      toast({
        title: "Nahráno",
        description:
          list.length === 1 ? "Obrázek byl přidán." : `Přidáno obrázků: ${list.length}.`,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nahrání selhalo",
        description: e instanceof Error ? e.message : "Zkuste jiný soubor.",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= images.length) return;
    const next = [...images];
    const t = next[idx];
    next[idx] = next[j];
    next[j] = t;
    await persistImages(next);
  };

  const removeAt = async (idx: number) => {
    const row = images[idx];
    if (!row) return;
    const next = images.filter((_, i) => i !== idx);
    try {
      const storage = getFirebaseStorage();
      if (row.storagePath) {
        await deleteObject(ref(storage, row.storagePath));
      }
    } catch {
      /* soubor už může chybět */
    }
    await persistImages(next);
    toast({ title: "Smazáno", description: "Obrázek byl odebrán." });
  };

  if (!canEdit) {
    return null;
  }

  return (
    <Card className={cn(JD.card)}>
      <CardHeader>
        <CardTitle className={JD.cardTitle}>Průběh pro zákaznický portál</CardTitle>
        <CardDescription>
          Nastavte procento dokončení a obrázky pro slider na přehledu / profilu zákazníka. Oddělené od
          interní fotodokumentace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor={`completion-${jobId}`}>Dokončení zakázky ({completion} %)</Label>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={savingPercent || completion === remotePercent}
              onClick={() => void handleSavePercent()}
            >
              {savingPercent ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit procenta"}
            </Button>
          </div>
          <Slider
            id={`completion-${jobId}`}
            min={0}
            max={100}
            step={1}
            value={[completion]}
            onValueChange={(v) => setCompletion(normalizeCompletionPercent(v[0] ?? 0))}
            className="w-full max-w-md"
          />
          <p className="text-xs text-muted-foreground">
            0 % = nová / nezahájeno, 100 % = dokončeno. Zákazník vidí stejnou hodnotu v portálu.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                Fotky pro zákaznický slider{" "}
                <span className="text-muted-foreground">({images.length})</span>
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-2"
              onClick={() => setImagesExpanded((v) => !v)}
              aria-expanded={imagesExpanded}
            >
              {imagesExpanded ? "Sbalit" : "Zobrazit více"}
              {imagesExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => void handlePickFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading || savingImages || !jobRef}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Nahrát obrázky
            </Button>
            {savingImages ? (
              <span className="text-xs text-muted-foreground">Ukládám…</span>
            ) : null}
          </div>

          {images.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádné obrázky pro zákaznický slider.</p>
          ) : (
            <div className="space-y-3">
              {!imagesExpanded ? (
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {images.slice(0, 4).map((img) => (
                      <div key={img.id} className="relative overflow-hidden rounded-md border bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.url}
                          alt=""
                          className="h-auto w-full aspect-[4/3] object-cover"
                          loading="lazy"
                        />
                      </div>
                    ))}
                  </div>
                  {images.length > 4 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Zobrazeno 4 z {images.length}. Klikněte na „Zobrazit více“ pro celý seznam.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {images.map((img, idx) => (
                    <div key={img.id} className="rounded-lg border bg-card overflow-hidden">
                      <div className="border-b bg-muted/20">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.url}
                          alt=""
                          className="h-auto w-full aspect-[4/3] object-cover"
                          loading="lazy"
                        />
                      </div>
                      <div className="p-3 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="h-8 w-8"
                              aria-label="Posunout nahoru"
                              disabled={idx === 0 || savingImages}
                              onClick={() => void move(idx, -1)}
                            >
                              <ChevronUp className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="h-8 w-8"
                              aria-label="Posunout dolů"
                              disabled={idx >= images.length - 1 || savingImages}
                              onClick={() => void move(idx, 1)}
                            >
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="destructive"
                              className="h-8 w-8"
                              aria-label="Smazat"
                              disabled={savingImages}
                              onClick={() => void removeAt(idx)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <span className="text-xs text-muted-foreground tabular-nums">#{idx + 1}</span>
                        </div>

                        <div className="space-y-2">
                          <div>
                            <Label className="text-xs">Název</Label>
                            <Input
                              value={img.title ?? ""}
                              placeholder="Volitelný název"
                              onChange={(e) => {
                                const v = e.target.value;
                                setImages((prev) => prev.map((p, i) => (i === idx ? { ...p, title: v } : p)));
                              }}
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                const next = imagesRef.current.map((p, i) => (i === idx ? { ...p, title: v } : p));
                                void persistImages(next);
                              }}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Popis</Label>
                            <Input
                              value={img.description ?? ""}
                              placeholder="Krátký popis"
                              onChange={(e) => {
                                const v = e.target.value;
                                setImages((prev) =>
                                  prev.map((p, i) => (i === idx ? { ...p, description: v } : p))
                                );
                              }}
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                const next = imagesRef.current.map((p, i) =>
                                  i === idx ? { ...p, description: v } : p
                                );
                                void persistImages(next);
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={img.visibleToCustomer !== false}
                                onCheckedChange={(checked) => {
                                  const next = imagesRef.current.map((p, i) =>
                                    i === idx ? { ...p, visibleToCustomer: checked } : p
                                  );
                                  void persistImages(next);
                                }}
                                disabled={savingImages}
                                id={`vis-${img.id}`}
                              />
                              <Label htmlFor={`vis-${img.id}`} className="text-sm font-normal">
                                Viditelné
                              </Label>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Po uložení se změny projeví v klientském portálu okamžitě (online synchronizace).
        </p>
      </CardContent>
    </Card>
  );
}
