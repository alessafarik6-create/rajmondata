"use client";

import React, { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Camera, ImagePlus, Loader2 } from "lucide-react";
import {
  collection,
  doc,
  limit,
  query,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import { uploadMeasurementPhotoFileViaFirebaseSdk } from "@/lib/job-photo-upload";
import {
  MEASUREMENT_PHOTO_SOURCE_TYPE,
  type MeasurementPhotoStatus,
} from "@/lib/measurement-photos";
import {
  isAllowedJobImageFile,
  JOB_IMAGE_ACCEPT_ATTR,
} from "@/lib/job-media-types";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";
import { userCanManageMeasurements } from "@/lib/measurements";
import { useMemoFirebase, useCollection } from "@/firebase";

type AssignmentMode = "job" | "customer" | "standalone";

type JobOption = { id: string; name?: string };
type CustomerOption = { id: string; companyName?: string; firstName?: string; lastName?: string };

export type MeasurementPhotoCaptureDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firestore: Firestore;
  companyId: string;
  userId: string;
  jobs: JobOption[];
  customers: CustomerOption[];
  profile: Record<string, unknown> | null | undefined;
};

export function MeasurementPhotoCaptureDialog({
  open,
  onOpenChange,
  firestore,
  companyId,
  userId,
  jobs,
  customers,
  profile,
}: MeasurementPhotoCaptureDialogProps) {
  const { toast } = useToast();
  const router = useRouter();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [assignment, setAssignment] = useState<AssignmentMode>("standalone");
  const [jobId, setJobId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [measurementId, setMeasurementId] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const measurementsQuery = useMemoFirebase(() => {
    if (
      !open ||
      !firestore ||
      !companyId ||
      !userCanManageMeasurements(profile ?? null)
    ) {
      return null;
    }
    return query(
      collection(firestore, "companies", companyId, "measurements"),
      limit(80)
    );
  }, [open, firestore, companyId, profile]);

  const { data: measurementsRaw } = useCollection(measurementsQuery);
  const measurementsList = Array.isArray(measurementsRaw) ? measurementsRaw : [];

  const resetForm = useCallback(() => {
    setAssignment("standalone");
    setJobId("");
    setCustomerId("");
    setMeasurementId("");
    setTitle("");
    setNote("");
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const processFile = async (file: File | null | undefined) => {
    if (!file || !companyId || !userId) return;
    if (!isAllowedJobImageFile(file)) {
      toast({
        variant: "destructive",
        title: "Nepodporovaný soubor",
        description: "Vyberte obrázek JPG, PNG nebo WebP.",
      });
      return;
    }

    let resolvedJobId: string | null = null;
    let resolvedCustomerId: string | null = null;
    let status: MeasurementPhotoStatus = "draft";

    if (assignment === "job") {
      const j = jobId.trim();
      if (!j) {
        toast({
          variant: "destructive",
          title: "Vyberte zakázku",
          description: "Pro vazbu na zakázku zvolte zakázku ze seznamu.",
        });
        return;
      }
      resolvedJobId = j;
      status = "linked";
    } else if (assignment === "customer") {
      const c = customerId.trim();
      if (!c) {
        toast({
          variant: "destructive",
          title: "Vyberte zákazníka",
          description: "Pro vazbu na zákazníka ho zvolte ze seznamu.",
        });
        return;
      }
      resolvedCustomerId = c;
      status = "draft";
    }

    const mId = measurementId.trim() || null;

    setSubmitting(true);
    try {
      const colRef = collection(firestore, "companies", companyId, "measurement_photos");
      const photoRef = doc(colRef);
      const photoDocId = photoRef.id;

      const up = await uploadMeasurementPhotoFileViaFirebaseSdk(
        file,
        companyId,
        photoDocId
      );

      const payload: Record<string, unknown> = {
        companyId,
        sourceType: MEASUREMENT_PHOTO_SOURCE_TYPE,
        originalImageUrl: up.downloadURL,
        storagePath: up.storagePath,
        annotatedImageUrl: null,
        annotatedStoragePath: null,
        title: title.trim() || null,
        note: note.trim() || null,
        status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
      };

      if (resolvedJobId) payload.jobId = resolvedJobId;
      if (resolvedCustomerId) payload.customerId = resolvedCustomerId;
      if (mId) payload.measurementId = mId;
      if (resolvedJobId) {
        payload.unassigned = true;
        payload.classificationStatus = "unassigned";
        payload.kind = "measurement";
      }

      await setDoc(photoRef, payload);

      toast({
        title: "Foto zaměření bylo uloženo",
        description:
          resolvedJobId != null
            ? "Otevřete editor anotací v detailu zakázky."
            : "Fotku najdete u zákazníka nebo v seznamu po přiřazení k zakázce.",
      });

      handleOpenChange(false);

      if (resolvedJobId) {
        router.push(`/portal/jobs/${resolvedJobId}?mp=${photoDocId}`);
      }
    } catch (e) {
      console.error("[MeasurementPhotoCaptureDialog]", e);
      toast({
        variant: "destructive",
        title: "Nahrání se nezdařilo",
        description: "Zkuste to znovu nebo zkontrolujte přístupová práva.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-lg w-[95vw] sm:w-full max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Foto zaměření</DialogTitle>
          <DialogDescription>
            Vyfoťte nebo nahrajte snímek. Po uložení můžete v detailu zakázky doplnit
            kóty a poznámky stejným editorem jako u fotodokumentace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto pr-1 flex-1 min-h-0">
          <div className="space-y-2">
            <Label>Vazba</Label>
            <select
              className={NATIVE_SELECT_CLASS}
              value={assignment}
              onChange={(e) =>
                setAssignment(e.target.value as AssignmentMode)
              }
            >
              <option value="standalone">Zaměření bez zakázky (přiřadím později)</option>
              <option value="customer">Přiřadit k zákazníkovi</option>
              <option value="job">Přiřadit k zakázce</option>
            </select>
          </div>

          {assignment === "job" ? (
            <div className="space-y-2">
              <Label htmlFor="mp-job">Zakázka</Label>
              <select
                id="mp-job"
                className={NATIVE_SELECT_CLASS}
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
              >
                <option value="">— vyberte —</option>
                {jobs
                  .filter((j) => j.id)
                  .map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name?.trim() || j.id}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}

          {assignment === "customer" ? (
            <div className="space-y-2">
              <Label htmlFor="mp-customer">Zákazník</Label>
              <select
                id="mp-customer"
                className={NATIVE_SELECT_CLASS}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">— vyberte —</option>
                {customers
                  .filter((c) => c.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.companyName ||
                        `${c.firstName || ""} ${c.lastName || ""}`.trim() ||
                        c.id}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}

          {userCanManageMeasurements(profile ?? null) &&
          measurementsList.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="mp-measurement">Napojit na plánované zaměření (volitelné)</Label>
              <select
                id="mp-measurement"
                className={NATIVE_SELECT_CLASS}
                value={measurementId}
                onChange={(e) => setMeasurementId(e.target.value)}
              >
                <option value="">— bez vazby na záznam zaměření —</option>
                {measurementsList.map((m: { id?: string; customerName?: string }) =>
                  m.id ? (
                    <option key={m.id} value={m.id}>
                      {m.customerName || m.id}
                    </option>
                  ) : null
                )}
              </select>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="mp-title">Název (volitelné)</Label>
            <Input
              id="mp-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="např. Pohled z ulice"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mp-note">Poznámka (volitelné)</Label>
            <Textarea
              id="mp-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
          </div>

          <input
            ref={cameraInputRef}
            type="file"
            accept={JOB_IMAGE_ACCEPT_ATTR}
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              void processFile(f);
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={JOB_IMAGE_ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              void processFile(f);
            }}
          />

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="default"
              className="gap-2 min-h-[44px] flex-1"
              disabled={submitting}
              onClick={() => cameraInputRef.current?.click()}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
              Vyfotit
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2 min-h-[44px] flex-1"
              disabled={submitting}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
              Nahrát z galerie / souboru
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            Zrušit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
