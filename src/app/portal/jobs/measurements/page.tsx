"use client";

import React, { useMemo, useState } from "react";
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
  DialogTrigger,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Loader2,
  ArrowLeft,
  Ruler,
  Briefcase,
  RefreshCw,
} from "lucide-react";
import {
  MEASUREMENT_STATUS_LABELS,
  type MeasurementDoc,
  type MeasurementStatus,
  isValidMeasurementPhone,
  parseEstimatedPrice,
  canConvertMeasurement,
  userCanManageMeasurements,
} from "@/lib/measurements";

const nativeSelectClass =
  "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[44px] sm:min-h-10";

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

export default function JobMeasurementsPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

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

  const { data: rawList, isLoading: listLoading } =
    useCollection<MeasurementDoc>(measurementsQuery);

  const [statusFilter, setStatusFilter] = useState<MeasurementStatus | "all">(
    "all"
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [convertTarget, setConvertTarget] = useState<MeasurementDoc | null>(
    null
  );
  const [converting, setConverting] = useState(false);

  const [form, setForm] = useState({
    customerName: "",
    phone: "",
    address: "",
    scheduledAtLocal: "",
    note: "",
    estimatedPrice: "",
  });

  const measurements = useMemo(() => {
    const list = Array.isArray(rawList) ? rawList : [];
    const mapped = list.map((m: any) => ({
      ...m,
      id: String(m?.id ?? ""),
    })) as MeasurementDoc[];
    const filtered =
      statusFilter === "all"
        ? mapped
        : mapped.filter((m) => m.status === statusFilter);
    return filtered.sort((a, b) =>
      String(b.scheduledAt || "").localeCompare(String(a.scheduledAt || ""))
    );
  }, [rawList, statusFilter]);

  const resetForm = () => {
    setForm({
      customerName: "",
      phone: "",
      address: "",
      scheduledAtLocal: "",
      note: "",
      estimatedPrice: "",
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !user) return;
    const name = form.customerName.trim();
    const phone = form.phone.trim();
    const address = form.address.trim();
    if (!name) {
      toast({
        variant: "destructive",
        title: "Chybí jméno",
        description: "Vyplňte jméno zákazníka.",
      });
      return;
    }
    if (!phone || !isValidMeasurementPhone(phone)) {
      toast({
        variant: "destructive",
        title: "Neplatný telefon",
        description: "Zadejte platné telefonní číslo (min. 9 číslic).",
      });
      return;
    }
    if (!address) {
      toast({
        variant: "destructive",
        title: "Chybí adresa",
        description: "Vyplňte adresu zaměření.",
      });
      return;
    }
    if (!form.scheduledAtLocal) {
      toast({
        variant: "destructive",
        title: "Chybí termín",
        description: "Vyberte datum a čas zaměření.",
      });
      return;
    }
    const price = parseEstimatedPrice(form.estimatedPrice);
    if (price === null) {
      toast({
        variant: "destructive",
        title: "Neplatná cena",
        description: "Zadejte nezáporné číslo (předběžná cena).",
      });
      return;
    }
    const scheduledIso = new Date(form.scheduledAtLocal).toISOString();

    setSubmitting(true);
    try {
      await addDoc(
        collection(firestore, "companies", companyId, "measurements"),
        {
          companyId,
          customerName: name,
          phone,
          address,
          scheduledAt: scheduledIso,
          note: form.note.trim(),
          estimatedPrice: price,
          status: "planned" as MeasurementStatus,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );
      toast({
        title: "Zaměření naplánováno",
        description: "Záznam byl uložen. Můžete ho později převést na zakázku.",
      });
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

  const handleConvert = async () => {
    if (!convertTarget || !companyId || !user) return;
    setConverting(true);
    try {
      const m = convertTarget;
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
        sourceMeasurementId: m.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const jobRef = await addDoc(
        collection(firestore, "companies", companyId, "jobs"),
        jobPayload
      );

      await updateDoc(
        doc(firestore, "companies", companyId, "measurements", m.id),
        {
          status: "converted",
          convertedJobId: jobRef.id,
          convertedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );

      toast({
        title: "Převod dokončen",
        description: `Vznikla zakázka. Pokračujte v detailu projektu.`,
      });
      setConvertTarget(null);
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
          <Button variant="ghost" className="gap-2 -ml-2 text-slate-600" asChild>
            <Link href="/portal/jobs">
              <ArrowLeft className="h-4 w-4" />
              Zpět na zakázky
            </Link>
          </Button>
          <h1 className="portal-page-title text-2xl sm:text-3xl">
            Zaměření
          </h1>
          <p className="portal-page-description max-w-2xl">
            Plánované zaměření u zákazníka je předstupeň klasické zakázky. Po
            převodu vznikne standardní zakázka a proces pokračuje stejně jako u
            ostatních projektů — bez ručního přepisování údajů.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button
              type="button"
              className="gap-2 min-h-[48px] shrink-0 bg-emerald-600 text-white hover:bg-emerald-700 border-0 shadow-md shadow-emerald-600/25"
            >
              <Ruler className="h-5 w-5" />
              Nové zaměření
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-white border-slate-200 text-slate-900">
            <DialogHeader>
              <DialogTitle>Naplánovat zaměření</DialogTitle>
              <DialogDescription>
                Vyplňte údaje o plánované návštěvě / zaměření u zákazníka.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="m-name">Jméno zákazníka / firma *</Label>
                <Input
                  id="m-name"
                  value={form.customerName}
                  onChange={(e) =>
                    setForm({ ...form, customerName: e.target.value })
                  }
                  required
                  placeholder="Např. Novák nebo Firma s.r.o."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-phone">Telefon *</Label>
                <Input
                  id="m-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) =>
                    setForm({ ...form, phone: e.target.value })
                  }
                  required
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
                <Label htmlFor="m-price">Předběžná cena (Kč)</Label>
                <Input
                  id="m-price"
                  type="text"
                  inputMode="decimal"
                  value={form.estimatedPrice}
                  onChange={(e) =>
                    setForm({ ...form, estimatedPrice: e.target.value })
                  }
                  placeholder="0"
                />
              </div>
              <DialogFooter className="gap-2 sm:gap-0 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Zrušit
                </Button>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Uložit zaměření"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100">
          <CardTitle className="text-lg flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-slate-500" />
            Přehled zaměření
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="m-filter" className="text-sm text-slate-600">
              Stav
            </Label>
            <select
              id="m-filter"
              className={nativeSelectClass}
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
            <div className="text-center py-16 text-slate-600">
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
                  <TableHead className="text-right">Akce</TableHead>
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
                      {canConvertMeasurement(row) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          className="gap-1 bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => setConvertTarget(row)}
                        >
                          <Briefcase className="h-4 w-4" />
                          Převést na zakázku
                        </Button>
                      ) : row.status === "converted" && row.convertedJobId ? (
                        <Button variant="link" size="sm" asChild>
                          <Link
                            href={`/portal/jobs/${row.convertedJobId}`}
                            className="text-primary"
                          >
                            Otevřít zakázku
                          </Link>
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!convertTarget}
        onOpenChange={(o) => !o && !converting && setConvertTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Převést zaměření na zakázku?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left">
              <span className="block">
                Vznikne nová zakázka s předvyplněnými údaji (zákazník, telefon,
                adresa, poznámka, předběžná cena jako rozpočet). Tento krok nelze
                vrátit — záznam zaměření bude označen jako převedený.
              </span>
              {convertTarget ? (
                <span className="block text-sm font-medium text-slate-800">
                  {convertTarget.customerName} ·{" "}
                  {formatScheduledDisplay(convertTarget.scheduledAt)}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={converting}>Zrušit</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={converting}
              onClick={(e) => {
                e.preventDefault();
                void handleConvert();
              }}
            >
              {converting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Ano, vytvořit zakázku"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
