"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { cs } from "date-fns/locale";
import {
  useFirestore,
  useCollection,
  useMemoFirebase,
  useUser,
  useDoc,
} from "@/firebase";
import {
  arrayUnion,
  collection,
  doc,
  addDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { linkMeasurementPhotosToConvertedJob } from "@/lib/measurement-photos";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Loader2,
  ArrowLeft,
  Ruler,
  Briefcase,
  RefreshCw,
  Pencil,
  Trash2,
  FileText,
} from "lucide-react";
import {
  MEASUREMENT_STATUS_LABELS,
  type MeasurementDoc,
  type MeasurementStatus,
  isValidMeasurementPhone,
  parseEstimatedPrice,
  canConvertMeasurement,
  canCreateAnotherJobFromMeasurement,
  userCanManageMeasurements,
} from "@/lib/measurements";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";
import type { JobTemplate, JobTemplateValues } from "@/lib/job-templates";
import { JobTemplateFormFields } from "@/components/jobs/job-template-form-fields";

function formatMoney(n: number): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: "CZK",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatScheduledDisplay(iso: string): string {
  try {
    const d = parseISO(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return format(d, "d. M. yyyy HH:mm", { locale: cs });
  } catch {
    return iso;
  }
}

function isoToDatetimeLocalValue(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function datetimeLocalToIso(local: string): string {
  return new Date(local).toISOString();
}

function isDeleted(m: MeasurementDoc & { deletedAt?: unknown }): boolean {
  return m.deletedAt != null;
}

function JobMeasurementsPageContent() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();
  const prefillFromLeadAppliedRef = useRef(false);

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc<any>(userRef);

  const companyId = profile?.companyId as string | undefined;
  const allowed = userCanManageMeasurements(profile);

  const measurementsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "measurements");
  }, [firestore, companyId]);

  const templatesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "jobTemplates");
  }, [firestore, companyId]);

  const { data: rawList, isLoading: listLoading } =
    useCollection<MeasurementDoc>(measurementsQuery);
  const { data: templatesData } = useCollection<JobTemplate>(templatesQuery);

  const templatesList = useMemo(
    () =>
      (Array.isArray(templatesData) ? templatesData : []).filter(
        (t) => t && t.id
      ) as JobTemplate[],
    [templatesData]
  );

  const [statusFilter, setStatusFilter] = useState<MeasurementStatus | "all">(
    "all"
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<MeasurementDoc | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [convertTarget, setConvertTarget] = useState<MeasurementDoc | null>(
    null
  );
  const [convertReconvert, setConvertReconvert] = useState(false);
  const [convertTemplateId, setConvertTemplateId] = useState<string>("");
  const [convertTemplateValues, setConvertTemplateValues] =
    useState<JobTemplateValues>({});
  const [converting, setConverting] = useState(false);

  const [form, setForm] = useState({
    customerName: "",
    phone: "",
    address: "",
    scheduledAtLocal: "",
    note: "",
    internalNote: "",
    estimatedPrice: "",
  });

  useEffect(() => {
    if (prefillFromLeadAppliedRef.current) return;
    const cn = searchParams.get("prefillCustomerName");
    const ph = searchParams.get("prefillPhone");
    const ad = searchParams.get("prefillAddress");
    const nt = searchParams.get("prefillNote");
    if (!cn && !ph && !ad && !nt) return;
    prefillFromLeadAppliedRef.current = true;

    setForm({
      customerName: cn?.trim() ?? "",
      phone: ph?.trim() ?? "",
      address: ad?.trim() ?? "",
      scheduledAtLocal: "",
      note: nt?.trim() ?? "",
      internalNote: "",
      estimatedPrice: "",
    });
    setDialogMode("create");
    setEditingId(null);
    setDialogOpen(true);
    router.replace("/portal/jobs/measurements", { scroll: false });
  }, [searchParams, router]);

  const measurements = useMemo(() => {
    const list = Array.isArray(rawList) ? rawList : [];
    const mapped = list.map((m: any) => ({
      ...m,
      id: String(m?.id ?? ""),
    })) as (MeasurementDoc & { deletedAt?: unknown })[];
    const noDeleted = mapped.filter((m) => !isDeleted(m));
    const filtered =
      statusFilter === "all"
        ? noDeleted
        : noDeleted.filter((m) => m.status === statusFilter);
    return filtered.sort((a, b) =>
      String(b.scheduledAt || "").localeCompare(String(a.scheduledAt || ""))
    );
  }, [rawList, statusFilter]);

  const selectedConvertTemplate = useMemo(() => {
    if (!convertTemplateId) return null;
    return templatesList.find((t) => String(t.id) === convertTemplateId) ?? null;
  }, [convertTemplateId, templatesList]);

  const resetForm = () => {
    setForm({
      customerName: "",
      phone: "",
      address: "",
      scheduledAtLocal: "",
      note: "",
      internalNote: "",
      estimatedPrice: "",
    });
    setEditingId(null);
    setDialogMode("create");
  };

  const openCreate = () => {
    resetForm();
    setDialogMode("create");
    setDialogOpen(true);
  };

  const openEdit = (row: MeasurementDoc) => {
    setDialogMode("edit");
    setEditingId(row.id);
    setForm({
      customerName: row.customerName || "",
      phone: row.phone || "",
      address: row.address || "",
      scheduledAtLocal: row.scheduledAt
        ? isoToDatetimeLocalValue(row.scheduledAt)
        : "",
      note: row.note || "",
      internalNote: (row as any).internalNote || "",
      estimatedPrice:
        row.estimatedPrice != null ? String(row.estimatedPrice) : "",
    });
    setDialogOpen(true);
  };

  const validateForm = (): boolean => {
    const name = form.customerName.trim();
    const phone = form.phone.trim();
    const address = form.address.trim();
    if (!name) {
      toast({
        variant: "destructive",
        title: "Chybí jméno",
        description: "Vyplňte jméno zákazníka nebo firmu.",
      });
      return false;
    }
    if (!phone || !isValidMeasurementPhone(phone)) {
      toast({
        variant: "destructive",
        title: "Neplatný telefon",
        description: "Zadejte platné telefonní číslo (min. 9 číslic).",
      });
      return false;
    }
    if (!address) {
      toast({
        variant: "destructive",
        title: "Chybí adresa",
        description: "Vyplňte adresu zaměření.",
      });
      return false;
    }
    if (!form.scheduledAtLocal) {
      toast({
        variant: "destructive",
        title: "Chybí termín",
        description: "Vyberte datum a čas zaměření.",
      });
      return false;
    }
    const price = parseEstimatedPrice(form.estimatedPrice);
    if (price === null) {
      toast({
        variant: "destructive",
        title: "Neplatná cena",
        description: "Zadejte nezáporné číslo (předběžná cena).",
      });
      return false;
    }
    return true;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !user) return;
    if (!validateForm()) return;

    const name = form.customerName.trim();
    const phone = form.phone.trim();
    const address = form.address.trim();
    const price = parseEstimatedPrice(form.estimatedPrice)!;
    const scheduledIso = datetimeLocalToIso(form.scheduledAtLocal);

    setSubmitting(true);
    try {
      if (dialogMode === "create") {
        await addDoc(
          collection(firestore, "companies", companyId, "measurements"),
          {
            companyId,
            customerName: name,
            phone,
            address,
            scheduledAt: scheduledIso,
            note: form.note.trim(),
            internalNote: form.internalNote.trim(),
            estimatedPrice: price,
            status: "planned" as MeasurementStatus,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }
        );
        toast({
          title: "Zaměření naplánováno",
          description: "Záznam byl uložen.",
        });
      } else if (editingId) {
        const row = measurements.find((m) => m.id === editingId);
        const isConverted = row?.status === "converted";
        const payload: Record<string, unknown> = {
          updatedAt: serverTimestamp(),
        };
        if (isConverted) {
          payload.note = form.note.trim();
          payload.internalNote = form.internalNote.trim();
        } else {
          payload.customerName = name;
          payload.phone = phone;
          payload.address = address;
          payload.scheduledAt = scheduledIso;
          payload.note = form.note.trim();
          payload.internalNote = form.internalNote.trim();
          payload.estimatedPrice = price;
        }
        await updateDoc(
          doc(firestore, "companies", companyId, "measurements", editingId),
          payload as never
        );
        toast({
          title: "Uloženo",
          description: isConverted
            ? "Poznámky byly aktualizované. Ostatní údaje u převedeného zaměření nelze měnit."
            : "Zaměření bylo upraveno.",
        });
      }
      setDialogOpen(false);
      resetForm();
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Nepodařilo se uložit zaměření.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSoftDelete = async () => {
    if (!deleteTarget || !companyId || !user) return;
    setDeleting(true);
    try {
      await updateDoc(
        doc(firestore, "companies", companyId, "measurements", deleteTarget.id),
        {
          deletedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );
      toast({
        title: "Zaměření odstraněno",
        description: deleteTarget.convertedJobId
          ? "Záznam byl skrytý. Navázaná zakázka zůstává zachovaná."
          : "Záznam byl skrytý z přehledu.",
      });
      setDeleteTarget(null);
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Smazání se nezdařilo.",
      });
    } finally {
      setDeleting(false);
    }
  };

  const openConvertDialog = (row: MeasurementDoc, reconvert: boolean) => {
    setConvertTarget(row);
    setConvertReconvert(reconvert);
    setConvertTemplateValues({});
    if (templatesList.length > 0) {
      const first = templatesList[0];
      setConvertTemplateId(String(first.id));
    } else {
      setConvertTemplateId("");
    }
  };

  const handleConvert = async () => {
    if (!convertTarget || !companyId || !user) return;
    if (templatesList.length > 0 && !convertTemplateId) {
      toast({
        variant: "destructive",
        title: "Vyberte šablonu",
        description: "Pro převod je potřeba zvolit šablonu zakázky.",
      });
      return;
    }
    setConverting(true);
    try {
      const m = convertTarget;
      const tpl = selectedConvertTemplate;
      const templateId = convertTemplateId || null;
      const templateName = tpl?.name || "";

      const jobPayload: Record<string, unknown> = {
        name: `Zakázka – ${m.customerName}`,
        description: [
          `Vytvořeno ze zaměření (${m.id}).`,
          m.note && `Poznámka ze zaměření: ${m.note}`,
          m.address && `Adresa: ${m.address}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        status: "nová",
        budget: Number(m.estimatedPrice) || 0,
        startDate: m.scheduledAt ? m.scheduledAt.slice(0, 10) : "",
        endDate: "",
        measuring: "po zaměření",
        measuringDetails: m.note || "",
        companyId,
        assignedEmployeeIds: [user.uid],
        customerId: null,
        customerName: m.customerName,
        customerPhone: m.phone,
        customerEmail: "",
        customerAddress: m.address,
        sourceMeasurementId: m.id,
        measurementTemplateId: templateId,
        measurementTemplateName: templateName || null,
        convertedFromMeasurementAt: serverTimestamp(),
        convertedFromMeasurementBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (templateId && tpl) {
        jobPayload.templateId = templateId;
        jobPayload.templateName = templateName;
        jobPayload.templateValues = convertTemplateValues;
      }

      const jobRef = await addDoc(
        collection(firestore, "companies", companyId, "jobs"),
        jobPayload
      );

      const prevJobId = m.convertedJobId;
      const measurementUpdate: Record<string, unknown> = {
        status: "converted",
        convertedJobId: jobRef.id,
        convertedAt: serverTimestamp(),
        convertedByUid: user.uid,
        selectedTemplateId: templateId,
        selectedTemplateName: templateName || null,
        updatedAt: serverTimestamp(),
      };
      if (
        convertReconvert &&
        prevJobId &&
        String(prevJobId) !== String(jobRef.id)
      ) {
        measurementUpdate.previousConvertedJobIds = arrayUnion(String(prevJobId));
      }

      await updateDoc(
        doc(firestore, "companies", companyId, "measurements", m.id),
        measurementUpdate as never
      );

      let linkedPhotos = 0;
      try {
        linkedPhotos = await linkMeasurementPhotosToConvertedJob(
          firestore,
          companyId,
          m.id,
          jobRef.id
        );
      } catch (linkErr) {
        console.error("[measurements] linkMeasurementPhotosToConvertedJob", linkErr);
      }

      toast({
        title: "Převod dokončen",
        description:
          linkedPhotos > 0
            ? `Zakázka byla vytvořena. ${linkedPhotos} foto zaměření bylo přiřazeno k zakázce.`
            : "Zakázka byla vytvořena. Můžete navázat smlouvou o dílo.",
      });
      setConvertTarget(null);
      setConvertReconvert(false);
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Převod se nezdařil",
        description: "Zkuste to znovu nebo kontaktujte správce.",
      });
    } finally {
      setConverting(false);
    }
  };

  const editingRowConverted =
    dialogMode === "edit" &&
    editingId &&
    measurements.find((x) => x.id === editingId)?.status === "converted";

  if (profileLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <Alert>
        <AlertTitle>Chybí firma</AlertTitle>
        <AlertDescription>
          Zaměření nelze spravovat bez přiřazení k organizaci.
        </AlertDescription>
      </Alert>
    );
  }

  if (!allowed) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Přístup odepřen</AlertTitle>
        <AlertDescription>
          Zaměření mohou spravovat vlastník, administrátor, manažer nebo účetní.
        </AlertDescription>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/portal/jobs">Zpět na zakázky</Link>
        </Button>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <Button variant="ghost" className="gap-2 -ml-2 text-slate-800" asChild>
            <Link href="/portal/jobs">
              <ArrowLeft className="h-4 w-4" />
              Zpět na zakázky
            </Link>
          </Button>
          <h1 className="portal-page-title text-2xl sm:text-3xl">Zaměření</h1>
          <p className="portal-page-description max-w-2xl">
            Plánované zaměření u zákazníka je předstupeň klasické zakázky. Po
            převodu vznikne standardní zakázka včetně zvolené šablony — proces
            pokračuje stejně jako u ostatních projektů.
          </p>
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-2">
          <Button
            type="button"
            onClick={openCreate}
            className="gap-2 min-h-[48px] shrink-0 bg-emerald-600 text-white hover:bg-emerald-700 border-0 shadow-md shadow-emerald-600/25 w-full sm:w-auto"
          >
            <Ruler className="h-5 w-5" />
            Nové zaměření
          </Button>
          <Dialog
            open={dialogOpen}
            onOpenChange={(o) => {
              setDialogOpen(o);
              if (!o) resetForm();
            }}
          >
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-white border-slate-200 text-slate-900">
            <DialogHeader>
              <DialogTitle>
                {dialogMode === "create"
                  ? "Naplánovat zaměření"
                  : "Upravit zaměření"}
              </DialogTitle>
              <DialogDescription>
                {editingRowConverted
                  ? "U převedeného zaměření lze upravit jen poznámky."
                  : "Vyplňte údaje o plánované návštěvě / zaměření u zákazníka."}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSave} className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="m-name">Jméno zákazníka / firma *</Label>
                <Input
                  id="m-name"
                  value={form.customerName}
                  onChange={(e) =>
                    setForm({ ...form, customerName: e.target.value })
                  }
                  required
                  disabled={!!editingRowConverted}
                  placeholder="Např. Novák nebo Firma s.r.o."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-phone">Telefon *</Label>
                <Input
                  id="m-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  required
                  disabled={!!editingRowConverted}
                  placeholder="+420 …"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-address">Adresa zaměření *</Label>
                <Textarea
                  id="m-address"
                  value={form.address}
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value })
                  }
                  rows={2}
                  required
                  disabled={!!editingRowConverted}
                  placeholder="Ulice, město, PSČ"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-when">Datum a čas zaměření *</Label>
                <Input
                  id="m-when"
                  type="datetime-local"
                  value={form.scheduledAtLocal}
                  onChange={(e) =>
                    setForm({ ...form, scheduledAtLocal: e.target.value })
                  }
                  required
                  disabled={!!editingRowConverted}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-note">Poznámka</Label>
                <Textarea
                  id="m-note"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  rows={3}
                  placeholder="Doplňující informace, přístup, výtah…"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-internal">Interní poznámka</Label>
                <Textarea
                  id="m-internal"
                  value={form.internalNote}
                  onChange={(e) =>
                    setForm({ ...form, internalNote: e.target.value })
                  }
                  rows={2}
                  placeholder="Pouze pro tým (nepovinné)"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-price">Předběžná cena (Kč)</Label>
                <Input
                  id="m-price"
                  type="text"
                  inputMode="decimal"
                  value={form.estimatedPrice}
                  onChange={(e) =>
                    setForm({ ...form, estimatedPrice: e.target.value })
                  }
                  disabled={!!editingRowConverted}
                  placeholder="0"
                />
              </div>
              <DialogFooter className="gap-2 sm:gap-0 pt-2 flex-col sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => setDialogOpen(false)}
                >
                  Zrušit
                </Button>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : dialogMode === "create" ? (
                    "Uložit zaměření"
                  ) : (
                    "Uložit změny"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100">
          <CardTitle className="text-lg flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-slate-800" />
            Přehled zaměření
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="m-filter" className="text-sm text-slate-800">
              Stav
            </Label>
            <select
              id="m-filter"
              className={NATIVE_SELECT_CLASS}
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as MeasurementStatus | "all")
              }
            >
              <option value="all">Všechny</option>
              {(Object.keys(MEASUREMENT_STATUS_LABELS) as MeasurementStatus[]).map(
                (k) => (
                  <option key={k} value={k}>
                    {MEASUREMENT_STATUS_LABELS[k]}
                  </option>
                )
              )}
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {listLoading ? (
            <div className="flex justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : measurements.length === 0 ? (
            <div className="text-center py-16 text-slate-800">
              <Ruler className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>Zatím nemáte žádné záznamy zaměření.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zákazník</TableHead>
                  <TableHead>Termín</TableHead>
                  <TableHead>Telefon</TableHead>
                  <TableHead className="min-w-[180px]">Adresa</TableHead>
                  <TableHead className="text-right">Předběžná cena</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead className="text-right min-w-[200px]">
                    Akce
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {measurements.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {row.customerName}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatScheduledDisplay(row.scheduledAt)}
                    </TableCell>
                    <TableCell>{row.phone}</TableCell>
                    <TableCell className="max-w-[220px] text-sm break-words">
                      {row.address}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(Number(row.estimatedPrice) || 0)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {MEASUREMENT_STATUS_LABELS[row.status] || row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col sm:flex-row gap-1 sm:justify-end sm:items-center flex-wrap">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => openEdit(row)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Upravit
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1 text-destructive border-destructive/30"
                          onClick={() => setDeleteTarget(row)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Smazat
                        </Button>
                        {canConvertMeasurement(row) ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="default"
                            className="gap-1 bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => openConvertDialog(row, false)}
                          >
                            <Briefcase className="h-4 w-4" />
                            Převést
                          </Button>
                        ) : null}
                        {canCreateAnotherJobFromMeasurement(row) ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="gap-1"
                            onClick={() => openConvertDialog(row, true)}
                          >
                            <Briefcase className="h-4 w-4" />
                            Další zakázka
                          </Button>
                        ) : null}
                        {row.status === "converted" && row.convertedJobId ? (
                          <div className="flex flex-col items-end gap-1">
                            <Button variant="link" size="sm" className="h-auto p-0" asChild>
                              <Link href={`/portal/jobs/${row.convertedJobId}`}>
                                Otevřít zakázku
                              </Link>
                            </Button>
                            <Button variant="link" size="sm" className="h-auto p-0 gap-1" asChild>
                              <Link
                                href={`/portal/jobs/${row.convertedJobId}?openSod=1`}
                              >
                                <FileText className="h-3.5 w-3.5" />
                                Smlouva o dílo
                              </Link>
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skrýt zaměření?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left">
              Záznam bude skrytý z přehledu (soft delete).
              {deleteTarget?.convertedJobId ? (
                <span className="block font-medium text-slate-800">
                  Existuje navázaná zakázka — ta zůstane nedotčená.
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Zrušit</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleSoftDelete();
              }}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Ano, skrýt"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!convertTarget}
        onOpenChange={(o) => {
          if (!o && !converting) {
            setConvertTarget(null);
            setConvertReconvert(false);
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {convertReconvert
                ? "Vytvořit další zakázku ze zaměření?"
                : "Převést zaměření na zakázku"}
            </DialogTitle>
            <DialogDescription>
              {convertReconvert
                ? "Vznikne nová zakázka vedle stávající. Záznam zaměření zůstane s odkazem na poslední vytvořenou zakázku."
                : "Vyberte šablonu zakázky (stejná sada šablon jako u nové zakázky). Povinné, pokud firma šablony má."}
            </DialogDescription>
          </DialogHeader>
          {convertTarget ? (
            <div className="space-y-4 py-2">
              <p className="text-sm font-medium text-slate-800">
                {convertTarget.customerName} ·{" "}
                {formatScheduledDisplay(convertTarget.scheduledAt)}
              </p>
              {templatesList.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                  <p className="font-medium">Žádná šablona zakázky</p>
                  <p className="mt-1">
                    Můžete{" "}
                    <Link
                      href="/portal/jobs/templates"
                      className="underline font-medium"
                    >
                      vytvořit šablonu
                    </Link>{" "}
                    a převod zopakovat, nebo pokračovat bez šablony.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="conv-tpl">Šablona zakázky *</Label>
                  <select
                    id="conv-tpl"
                    className={NATIVE_SELECT_CLASS}
                    value={convertTemplateId}
                    onChange={(e) => {
                      setConvertTemplateId(e.target.value);
                      setConvertTemplateValues({});
                    }}
                  >
                    {templatesList.map((t) => (
                      <option key={String(t.id)} value={String(t.id)}>
                        {t.name}
                        {t.productType ? ` (${t.productType})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {selectedConvertTemplate ? (
                <JobTemplateFormFields
                  template={selectedConvertTemplate}
                  values={convertTemplateValues}
                  onChange={setConvertTemplateValues}
                />
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={converting}
              onClick={() => {
                setConvertTarget(null);
                setConvertReconvert(false);
              }}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700"
              disabled={
                converting ||
                (templatesList.length > 0 && !convertTemplateId)
              }
              onClick={() => void handleConvert()}
            >
              {converting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Vytvořit zakázku"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function JobMeasurementsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <JobMeasurementsPageContent />
    </Suspense>
  );
}
