"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useCompany,
  useDoc,
  useFirestore,
  useMemoFirebase,
  useUser,
} from "@/firebase";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, ArrowLeft, UserX } from "lucide-react";
import { EmployeeDocumentsSection } from "@/components/portal/EmployeeDocumentsSection";
import { EmployeeGenerateDocumentDialog } from "@/components/portal/EmployeeGenerateDocumentDialog";

function employeeDisplayName(e: Record<string, unknown> | null | undefined): string {
  if (!e) return "Zaměstnanec";
  const first = String(e.firstName ?? "").trim();
  const last = String(e.lastName ?? "").trim();
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full || String(e.email ?? "").trim() || "Zaměstnanec";
}

function employeeTerminalStatus(e: Record<string, unknown> | null | undefined): {
  hasPin: boolean;
  needsChange: boolean;
} {
  const pinActive = e?.terminalPinActive;
  const legacy = e?.attendancePin;
  const hasPin =
    pinActive === true ||
    (pinActive !== false && legacy != null && String(legacy).trim().length > 0);
  return {
    hasPin,
    needsChange: e?.terminalPinNeedsChange === true,
  };
}

export default function EmployeeDetailPage() {
  const router = useRouter();
  const params = useParams<{ employeeId: string }>();
  const employeeId = String(params?.employeeId ?? "").trim();

  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { companyName } = useCompany();
  const { company } = useCompany();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc<any>(userRef);
  const companyId = profile?.companyId as string | undefined;

  const employeeRef = useMemoFirebase(
    () =>
      firestore && companyId && employeeId
        ? doc(firestore, "companies", companyId, "employees", employeeId)
        : null,
    [firestore, companyId, employeeId]
  );
  const { data: employeeDoc, isLoading: employeeLoading, error: employeeError } =
    useDoc<Record<string, unknown>>(employeeRef);

  const [savingStatus, setSavingStatus] = useState(false);
  const isActive =
    employeeDoc?.isActive == null ? true : Boolean(employeeDoc?.isActive);

  const terminal = useMemo(() => employeeTerminalStatus(employeeDoc), [employeeDoc]);

  const canManage = useMemo(() => {
    const role = String(profile?.role ?? "").trim();
    return ["owner", "admin", "manager", "accountant", "super_admin"].includes(role);
  }, [profile?.role]);

  const display = useMemo(() => employeeDisplayName(employeeDoc), [employeeDoc]);

  const toggleActive = async () => {
    if (!canManage || !employeeRef || savingStatus) return;
    setSavingStatus(true);
    try {
      await updateDoc(employeeRef, {
        isActive: !isActive,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setSavingStatus(false);
    }
  };

  if (isUserLoading || profileLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-black">
        <Loader2 className="h-7 w-7 animate-spin" />
        Načítání…
      </div>
    );
  }

  if (!user || !companyId || !employeeId) {
    return (
      <Alert variant="destructive" className="max-w-xl">
        <AlertTitle>Chybí přístup</AlertTitle>
        <AlertDescription>
          Tuto stránku lze otevřít pouze po přihlášení v rámci organizace.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-2 pb-12 sm:px-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 border-slate-300"
              onClick={() => router.push("/portal/employees")}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Zaměstnanci
            </Button>
            <p className="text-sm text-slate-700">
              {companyName ? `${companyName} · ` : ""}Detail zaměstnance
            </p>
          </div>
          <h1 className="mt-2 break-words text-xl font-bold text-black sm:text-2xl">
            {display}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={isActive ? "default" : "secondary"}
            className="capitalize"
          >
            {isActive ? "Aktivní" : "Neaktivní"}
          </Badge>
          {canManage ? (
            <Button
              type="button"
              variant={isActive ? "destructive" : "default"}
              className="h-10"
              disabled={savingStatus}
              onClick={() => void toggleActive()}
            >
              {savingStatus ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <UserX className="mr-2 h-4 w-4" />
                  {isActive ? "Deaktivovat" : "Aktivovat"}
                </>
              )}
            </Button>
          ) : null}
        </div>
      </div>

      {employeeError ? (
        <Alert variant="destructive">
          <AlertTitle>Nelze načíst zaměstnance</AlertTitle>
          <AlertDescription>
            Zkuste stránku obnovit. Pokud problém přetrvá, zkontrolujte oprávnění.
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
          <TabsTrigger value="overview" className="h-10">
            Přehled
          </TabsTrigger>
          <TabsTrigger value="documents" className="h-10">
            Dokumenty
          </TabsTrigger>
          <TabsTrigger value="contracts" className="h-10">
            Smlouvy a dohody
          </TabsTrigger>
          <TabsTrigger value="photos" className="h-10">
            Fotodokumentace
          </TabsTrigger>
          <TabsTrigger value="signatures" className="h-10">
            Podpisy
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <CardTitle className="text-lg text-black">Profil zaměstnance</CardTitle>
            </CardHeader>
            <CardContent>
              {employeeLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-800">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Načítání profilu…
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Jméno</Label>
                    <p className="font-medium text-black">
                      {String(employeeDoc?.firstName ?? "").trim()}{" "}
                      {String(employeeDoc?.lastName ?? "").trim()}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">E-mail</Label>
                    <p className="font-medium text-black">
                      {String(employeeDoc?.email ?? "—")}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Telefon</Label>
                    <p className="font-medium text-black">
                      {String(employeeDoc?.phone ?? employeeDoc?.phoneNumber ?? "—")}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Pracovní pozice</Label>
                    <p className="font-medium text-black">
                      {String(employeeDoc?.jobTitle ?? employeeDoc?.position ?? "—")}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Hodinová sazba / mzda</Label>
                    <p className="font-medium text-black">
                      {employeeDoc?.hourlyRate != null && employeeDoc?.hourlyRate !== ""
                        ? `${String(employeeDoc.hourlyRate)} Kč/h`
                        : employeeDoc?.salary != null && employeeDoc?.salary !== ""
                          ? `${String(employeeDoc.salary)} Kč`
                          : "—"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">PIN / stav terminálu</Label>
                    <p className="font-medium text-black">
                      {terminal.hasPin ? "PIN nastaven" : "Bez PINu"}
                      {terminal.needsChange ? " · změnit v profilu" : ""}
                    </p>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label className="text-xs text-slate-600">Poznámky</Label>
                    <Textarea
                      value={String(employeeDoc?.note ?? employeeDoc?.notes ?? "")}
                      readOnly
                      className="min-h-[88px] border-slate-200 bg-slate-50 text-black"
                    />
                    <p className="text-xs text-slate-600">
                      Úpravy osobních údajů a poznámek doplníme do editačního režimu v dalších
                      krocích.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="mt-4 space-y-4">
          <EmployeeDocumentsSection
            companyId={companyId}
            employeeId={employeeId}
            canManage={canManage}
            mode="all"
            title="Dokumenty zaměstnance"
          />
        </TabsContent>

        <TabsContent value="contracts" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-700">
              Vygenerované PDF se automaticky uloží do dokumentů zaměstnance.
            </p>
            <EmployeeGenerateDocumentDialog
              companyId={companyId}
              employeeId={employeeId}
              canManage={canManage}
              company={company as Record<string, unknown> | null | undefined}
              employee={employeeDoc ?? undefined}
            />
          </div>
          <EmployeeDocumentsSection
            companyId={companyId}
            employeeId={employeeId}
            canManage={canManage}
            mode="contracts"
            title="Smlouvy a dohody"
          />
        </TabsContent>

        <TabsContent value="photos" className="mt-4 space-y-4">
          <EmployeeDocumentsSection
            companyId={companyId}
            employeeId={employeeId}
            canManage={canManage}
            mode="photos"
            title="Fotodokumentace"
          />
        </TabsContent>

        <TabsContent value="signatures" className="mt-4 space-y-4">
          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <CardTitle className="text-lg text-black">Podpisy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-slate-700">
                Podepisování bude navázané na vygenerované PDF dokumenty (zaměstnanec/firma).
              </p>
              <p className="text-xs text-slate-600">
                Podpis může být kreslený (canvas) nebo nahraný obrázek; finální podepsané PDF se uloží
                jako nová verze.
              </p>
              <p className="text-xs text-slate-600">
                Zpět do seznamu:{" "}
                <Link href="/portal/employees" className="underline underline-offset-2">
                  Zaměstnanci
                </Link>
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

