"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DocumentData, Firestore, UpdateData } from "firebase/firestore";
import {
  collection,
  deleteField,
  doc,
  limit,
  query,
  updateDoc,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { useCollection, useMemoFirebase } from "@/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Camera, ChevronDown, ChevronUp, Loader2, MoreHorizontal } from "lucide-react";
import { getJobMediaPreviewUrl, formatMediaDate } from "@/lib/job-media-types";
import {
  isMeasurementPhotoUnassignedForJob,
  measurementPhotoHasValidAssignment,
  repairOrphanAssignedMeasurementPhotos,
} from "@/lib/measurement-photos";
import { MEASUREMENT_PHOTO_PENDING_EDITOR_ROUTE_JOB_ID } from "@/lib/measurement-photo-pending-route";
import { userCanManageMeasurements } from "@/lib/measurements";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";

const PAGE_LIMIT = 60;
const COLLAPSED_COUNT = 5;

type JobNameMap = Record<string, string>;

type Row = Record<string, unknown> & { id: string; createdBy?: string | undefined };

type JobOption = { id: string; name?: string };

type ProfileLike = Record<string, unknown> | null | undefined;

type Props = {
  firestore: Firestore | null;
  companyId: string | null | undefined;
  jobNamesById: JobNameMap;
  /** Zakázky pro výběr při přiřazení (dle oprávnění uživatele). */
  jobsForAssign: JobOption[];
  userId: string | null | undefined;
  profile: ProfileLike;
};

function editorHrefForMeasurementRow(row: Row): string {
  const jobId =
    typeof row.jobId === "string" && row.jobId.trim() ? row.jobId.trim() : "";
  const base = jobId
    ? `/portal/jobs/${jobId}`
    : `/portal/jobs/${MEASUREMENT_PHOTO_PENDING_EDITOR_ROUTE_JOB_ID}`;
  return `${base}?mp=${encodeURIComponent(row.id)}`;
}

function previewUrlForRow(row: Row): string | undefined {
  return getJobMediaPreviewUrl({
    annotatedImageUrl:
      typeof row.annotatedImageUrl === "string" ? row.annotatedImageUrl : undefined,
    imageUrl:
      typeof row.originalImageUrl === "string" ? row.originalImageUrl : undefined,
  });
}

export function DashboardUnassignedMeasurementPhotos({
  firestore,
  companyId,
  jobNamesById,
  jobsForAssign,
  userId,
  profile,
}: Props) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lightboxRow, setLightboxRow] = useState<Row | null>(null);
  const [assignRow, setAssignRow] = useState<Row | null>(null);
  const [assignKind, setAssignKind] = useState<"job" | "measurement">("job");
  const [assignJobId, setAssignJobId] = useState("");
  const [assignMeasurementId, setAssignMeasurementId] = useState("");

  const canManageMeasurements = userCanManageMeasurements(
    profile as { role?: string; globalRoles?: unknown } | null
  );
  const role = String((profile as { role?: string })?.role ?? "");
  const canManagePhotos =
    ["owner", "admin", "manager", "accountant"].includes(role) ||
    (Array.isArray((profile as { globalRoles?: unknown })?.globalRoles) &&
      (profile as { globalRoles: string[] }).globalRoles.includes("super_admin"));

  const qRef = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    /** Bez orderBy — nevyžaduje složený index; řazení řešíme na klientovi. */
    return query(
      collection(firestore, "companies", companyId, "measurement_photos"),
      where("unassigned", "==", true),
      limit(PAGE_LIMIT * 3)
    );
  }, [firestore, companyId]);

  const measurementsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !canManageMeasurements) return null;
    return query(collection(firestore, "companies", companyId, "measurements"), limit(120));
  }, [firestore, companyId, canManageMeasurements]);

  const { data: rawRows, isLoading } = useCollection(qRef);
  const { data: measurementsRaw } = useCollection(measurementsQuery);
  const measurementsList = useMemo(() => {
    const list = Array.isArray(measurementsRaw) ? measurementsRaw : [];
    return list.filter((m: { deletedAt?: unknown }) => m.deletedAt == null);
  }, [measurementsRaw]);

  const rows = useMemo(() => {
    const list = (rawRows ?? []) as Row[];
    const filtered = list.filter((r) => isMeasurementPhotoUnassignedForJob(r));
    const t = (v: unknown): number => {
      if (v == null) return 0;
      if (typeof v === "number" && !Number.isNaN(v)) return v;
      if (typeof (v as { toMillis?: () => number }).toMillis === "function") {
        return (v as { toMillis: () => number }).toMillis();
      }
      if (typeof (v as { toDate?: () => Date }).toDate === "function") {
        return (v as { toDate: () => Date }).toDate().getTime();
      }
      return 0;
    };
    return [...filtered].sort((a, b) => t(b.createdAt) - t(a.createdAt));
  }, [rawRows]);

  const visible = expanded ? rows : rows.slice(0, COLLAPSED_COUNT);
  const hasMore = rows.length > COLLAPSED_COUNT;

  useEffect(() => {
    if (!firestore || !companyId) return;
    let cancelled = false;
    void repairOrphanAssignedMeasurementPhotos(firestore, companyId)
      .then((n) => {
        if (cancelled || n === 0) return;
        toast({
          title: "Opraveny záznamy foto zaměření",
          description: `${n} fotek bez vazby na zakázku nebo zaměření bylo vráceno mezi nezařazené.`,
        });
      })
      .catch((e) => {
        console.error("[DashboardUnassignedMeasurementPhotos] orphan repair", e);
        toast({
          variant: "destructive",
          title: "Oprava dat se nezdařila",
          description: e instanceof Error ? e.message : "Zkuste obnovit stránku.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [firestore, companyId, toast]);

  const openAssign = (row: Row, kind: "job" | "measurement" = "job") => {
    setAssignRow(row);
    setAssignKind(kind === "measurement" && canManageMeasurements ? "measurement" : "job");
    setAssignJobId("");
    setAssignMeasurementId(
      typeof row.measurementId === "string" && row.measurementId.trim()
        ? row.measurementId.trim()
        : ""
    );
  };

  const submitAssign = async () => {
    if (!firestore || !companyId || !userId || !assignRow) return;
    if (assignKind === "job") {
      const jid = assignJobId.trim();
      if (!jid) {
        toast({
          variant: "destructive",
          title: "Vyberte zakázku",
          description: "Bez zakázky nelze přiřazení dokončit.",
        });
        return;
      }
      const jobMeta = jobsForAssign.find((j) => j.id === jid);
      setBusyId(assignRow.id);
      try {
        const payload: Record<string, unknown> = {
          jobId: jid,
          unassigned: false,
          classificationStatus: "assigned",
          assignedType: "job",
          assignedAt: serverTimestamp(),
          assignedBy: userId,
          updatedAt: serverTimestamp(),
          measurementId: deleteField(),
        };
        if (jobMeta?.name?.trim()) {
          payload.jobName = jobMeta.name.trim();
        }
        if (
          !measurementPhotoHasValidAssignment({
            ...assignRow,
            ...payload,
            jobId: jid,
          } as Record<string, unknown>)
        ) {
          toast({
            variant: "destructive",
            title: "Nelze uložit",
            description: "Chybí platná vazba na zakázku.",
          });
          setBusyId(null);
          return;
        }
        await updateDoc(
          doc(firestore, "companies", companyId, "measurement_photos", assignRow.id),
          payload as UpdateData<DocumentData>
        );
        toast({
          title: "Přiřazeno k zakázce",
          description: "Fotku najdete u zakázky v sekci Foto zaměření.",
        });
        setAssignRow(null);
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Přiřazení se nezdařilo",
          description: e instanceof Error ? e.message : "Zkuste to znovu.",
        });
      } finally {
        setBusyId(null);
      }
      return;
    }

    const mid = assignMeasurementId.trim();
    if (!mid) {
      toast({
        variant: "destructive",
        title: "Vyberte zaměření",
        description: "Zvolte záznam zaměření ze seznamu.",
      });
      return;
    }
    setBusyId(assignRow.id);
    try {
      const measPatch = {
        measurementId: mid,
        jobId: deleteField(),
        jobName: deleteField(),
        unassigned: false,
        classificationStatus: "assigned",
        assignedType: "measurement",
        assignedAt: serverTimestamp(),
        assignedBy: userId,
        updatedAt: serverTimestamp(),
      } satisfies UpdateData<DocumentData>;
      if (
        !measurementPhotoHasValidAssignment({
          ...assignRow,
          jobId: null,
          measurementId: mid,
          assignedType: "measurement",
          unassigned: false,
        } as Record<string, unknown>)
      ) {
        toast({
          variant: "destructive",
          title: "Nelze uložit",
          description: "Chybí platná vazba na zaměření.",
        });
        setBusyId(null);
        return;
      }
      await updateDoc(
        doc(firestore, "companies", companyId, "measurement_photos", assignRow.id),
        measPatch
      );
      toast({
        title: "Přiřazeno k zaměření",
        description: "Fotka je navázaná na vybrané zaměření (přehled zaměření / zákazník).",
      });
      setAssignRow(null);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Přiřazení se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const rowTypeLabel = (row: Row): string => {
    const k = typeof row.kind === "string" ? row.kind.trim() : "";
    if (k) return k;
    const st = typeof row.source === "string" ? row.source.trim() : "";
    if (st) return st;
    return "Foto zaměření";
  };

  if (!companyId) return null;

  const lightboxUrl = lightboxRow ? previewUrlForRow(lightboxRow) : undefined;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Camera className="h-5 w-5 shrink-0" />
          Nezařazené fotky k zakázkám
        </CardTitle>
        <CardDescription>
          Foto zaměření označená jako nezařazená — včetně snímků bez vybrané zakázky. Otevřete náhled,
          upravte anotace ve stejném editoru jako u zakázky, nebo přiřaďte k zakázce / zaměření.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žádné nezařazené fotky.</p>
        ) : (
          <>
            <ul className="divide-y rounded-md border">
              {visible.map((row) => {
                const jobId =
                  typeof row.jobId === "string" && row.jobId.trim() ? row.jobId.trim() : "";
                const jobName =
                  (jobId && jobNamesById[jobId]) ||
                  (jobId ? `Zakázka ${jobId.slice(0, 8)}…` : "Bez zakázky");
                const preview = previewUrlForRow(row);
                const titleStr =
                  typeof row.title === "string" && row.title.trim()
                    ? row.title.trim()
                    : "Foto zaměření";
                const uploadedByNameRaw = (row as Record<string, unknown>).uploadedByName;
                const authorStr =
                  typeof uploadedByNameRaw === "string" && uploadedByNameRaw.trim()
                    ? uploadedByNameRaw.trim()
                    : typeof row.createdBy === "string" && row.createdBy
                      ? `ID ${row.createdBy.slice(0, 8)}…`
                      : null;
                const editHref = editorHrefForMeasurementRow(row);
                const isBusy = busyId === row.id;

                return (
                  <li
                    key={row.id}
                    className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3"
                  >
                    <div className="flex gap-3 min-w-0 flex-1">
                      <button
                        type="button"
                        className="h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted text-left focus:outline-none focus:ring-2 focus:ring-primary"
                        onClick={() => setLightboxRow(row)}
                        title="Otevřít náhled"
                      >
                        {preview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={preview} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground p-1 text-center">
                            Bez náhledu
                          </div>
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{titleStr}</p>
                        <p className="text-xs text-muted-foreground truncate">{jobName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground/80">{rowTypeLabel(row)}</span>
                          <span className="mx-1">·</span>
                          {formatMediaDate(row.createdAt)}
                          {authorStr ? <span className="ml-1">· {authorStr}</span> : null}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1"
                            disabled={isBusy}
                          >
                            {isBusy ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="h-4 w-4" />
                            )}
                            Akce
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem onSelect={() => setLightboxRow(row)}>
                            Otevřít
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={editHref}>Upravit</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => openAssign(row, "job")}
                            disabled={!canManagePhotos}
                          >
                            Přiřadit k zakázce
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => openAssign(row, "measurement")}
                            disabled={!canManageMeasurements}
                          >
                            Přiřadit k zaměření
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </li>
                );
              })}
            </ul>
            {hasMore ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-4 w-4" />
                    Zobrazit méně
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4" />
                    Zobrazit více ({rows.length - COLLAPSED_COUNT} dalších)
                  </>
                )}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>

      <Dialog open={Boolean(lightboxRow)} onOpenChange={(o) => !o && setLightboxRow(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Náhled — foto zaměření</DialogTitle>
            <DialogDescription>
              {lightboxRow &&
              typeof lightboxRow.title === "string" &&
              lightboxRow.title.trim()
                ? lightboxRow.title.trim()
                : "Nezařazené foto"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[min(70vh,560px)] items-center justify-center overflow-auto rounded-md border bg-muted/30 p-2">
            {lightboxUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={lightboxUrl}
                alt=""
                className="max-h-[min(65vh,520px)] w-auto max-w-full object-contain"
              />
            ) : (
              <p className="text-sm text-muted-foreground py-8">Náhled není k dispozici.</p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setLightboxRow(null)}>
              Zavřít
            </Button>
            {lightboxRow ? (
              <Button type="button" asChild>
                <Link href={editorHrefForMeasurementRow(lightboxRow)} onClick={() => setLightboxRow(null)}>
                  Upravit
                </Link>
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(assignRow)}
        onOpenChange={(o) => {
          if (!o) setAssignRow(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Přiřadit foto zaměření</DialogTitle>
            <DialogDescription>
              Vyberte zakázku nebo záznam plánovaného zaměření. Po uložení zmizí fotka z tohoto přehledu.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Typ přiřazení</Label>
              <select
                className={NATIVE_SELECT_CLASS}
                value={assignKind}
                onChange={(e) =>
                  setAssignKind(e.target.value === "measurement" ? "measurement" : "job")
                }
              >
                <option value="job">Zakázka</option>
                <option value="measurement" disabled={!canManageMeasurements}>
                  Zaměření (plánované)
                </option>
              </select>
              {!canManageMeasurements ? (
                <p className="text-[11px] text-muted-foreground">
                  Přiřazení k zaměření je dostupné rolím s přístupem k přehledu zaměření.
                </p>
              ) : null}
            </div>
            {assignKind === "job" ? (
              <div className="space-y-1">
                <Label>Zakázka</Label>
                <Select value={assignJobId || "__none__"} onValueChange={(v) => setAssignJobId(v === "__none__" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Vyberte zakázku" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— vyberte —</SelectItem>
                    {jobsForAssign
                      .filter((j) => j.id)
                      .map((j) => (
                        <SelectItem key={j.id} value={j.id}>
                          {j.name?.trim() || j.id}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Zaměření</Label>
                <select
                  className={NATIVE_SELECT_CLASS}
                  value={assignMeasurementId}
                  onChange={(e) => setAssignMeasurementId(e.target.value)}
                >
                  <option value="">— vyberte zaměření —</option>
                  {measurementsList.map((m: { id?: string; customerName?: string }) =>
                    m.id ? (
                      <option key={m.id} value={m.id}>
                        {m.customerName || m.id}
                      </option>
                    ) : null
                  )}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAssignRow(null)}>
              Zrušit
            </Button>
            <Button
              type="button"
              disabled={busyId === assignRow?.id}
              onClick={() => void submitAssign()}
            >
              {busyId === assignRow?.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Uložit přiřazení"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
