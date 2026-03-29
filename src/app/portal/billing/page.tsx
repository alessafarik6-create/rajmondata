"use client";

import React, { useEffect, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Loader2, Lock } from "lucide-react";
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useMergedPlatformModuleCatalog } from "@/contexts/platform-module-catalog-context";
import {
  type CompanyPlatformFields,
  getEffectiveModulesMerged,
} from "@/lib/platform-access";
import type { CompanyLicenseDoc } from "@/lib/platform-config";
import { COMPANY_LICENSES_COLLECTION } from "@/lib/firestore-collections";
import {
  buildSubscriptionModuleLines,
  sumSubscriptionMonthlyCzk,
} from "@/lib/subscription-modules-display";

export default function BillingPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const moduleCatalog = useMergedPlatformModuleCatalog();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);
  const companyId = profile?.companyId as string | undefined;

  const companyRef = useMemoFirebase(
    () => (companyId && firestore ? doc(firestore, "companies", companyId) : null),
    [firestore, companyId]
  );
  const { data: company, isLoading: isCompanyLoading } = useDoc(companyRef);

  const licenseRef = useMemoFirebase(
    () =>
      companyId && firestore
        ? doc(firestore, COMPANY_LICENSES_COLLECTION, companyId)
        : null,
    [firestore, companyId]
  );
  const { data: licenseRaw, isLoading: isLicenseLoading } = useDoc(licenseRef);

  const licenseDoc = licenseRaw as CompanyLicenseDoc | null | undefined;

  const subscriptionItems = useMemo(() => {
    if (!company) return [];
    return buildSubscriptionModuleLines(
      company as CompanyPlatformFields,
      moduleCatalog,
      licenseDoc ?? null
    );
  }, [company, moduleCatalog, licenseDoc]);

  const totalRow = useMemo(
    () => sumSubscriptionMonthlyCzk(subscriptionItems),
    [subscriptionItems]
  );

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !company) return;
    console.log("module catalog", moduleCatalog);
    console.log(
      "effective modules",
      getEffectiveModulesMerged(company as CompanyPlatformFields)
    );
    console.log("subscription items", subscriptionItems);
  }, [company, moduleCatalog, subscriptionItems]);

  const isOwner = profile?.role === "owner";

  if (isProfileLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-xl border-slate-200 bg-slate-50">
        <AlertTitle>Není vybraná firma</AlertTitle>
        <AlertDescription>
          Předplatné nelze načíst bez přiřazení k organizaci.
        </AlertDescription>
      </Alert>
    );
  }

  if (isCompanyLoading || isLicenseLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!company) {
    return (
      <Alert variant="destructive" className="max-w-xl border-destructive/60">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Firma neexistuje</AlertTitle>
        <AlertDescription>
          Dokument firmy ve Firestore chybí nebo k němu nemáte přístup.
        </AlertDescription>
      </Alert>
    );
  }

  const billing = company?.billing as
    | {
        paymentStatus?: string;
        nextPaymentDate?: string;
        billingCycle?: string;
      }
    | undefined;

  const paymentStatus = billing?.paymentStatus;
  const isActive = paymentStatus === "active";

  return (
    <div className="mx-auto max-w-5xl space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">Předplatné</h1>
          <p className="portal-page-description">
            Přehled aktivních licencovaných modulů vaší organizace a orientační ceny podle centrálního
            ceníku.
          </p>
        </div>
        <Badge
          variant={isActive ? "default" : "secondary"}
          className="h-8 w-fit gap-2 px-4 text-sm"
        >
          {isActive ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          Účet:{" "}
          {isActive
            ? "Aktivní"
            : paymentStatus
              ? String(paymentStatus)
              : "bez záznamu platby"}
        </Badge>
      </div>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="border-b border-primary/10 bg-primary/5">
          <CardTitle className="text-xl">Aktivní moduly</CardTitle>
          <CardDescription>
            Zobrazeny jsou pouze platformní moduly, které máte zapnuté v licenci. Úpravy provádí
            administrátor platformy.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          {subscriptionItems.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">
              Nemáte aktivní žádný licencovaný modul z nabídky, nebo licence ještě není nastavená.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Modul</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead className="text-right">Cena / měsíc</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptionItems.map((row) => (
                  <TableRow key={row.moduleCode}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {row.statusLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">{row.priceLabel}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell colSpan={2}>Celkem (orientačně, CZK / měsíc)</TableCell>
                  <TableCell className="text-right">
                    {totalRow.total != null
                      ? `${Math.round(totalRow.total).toLocaleString("cs-CZ")} Kč`
                      : "—"}
                    {totalRow.partial ? (
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        Část částek nelze sečíst (např. chybí počet zaměstnanců u docházky nebo jiná
                        měna).
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="min-w-0 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Lock className="h-4 w-4 text-primary" /> Fakturační údaje
            </CardTitle>
            <CardDescription>Údaje organizace pro fakturaci od dodavatele služby.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-bold uppercase text-muted-foreground">Firma</p>
              <p className="font-medium">
                {company?.companyName ?? company?.name ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-muted-foreground">IČO</p>
              <p className="font-mono">{company?.ico ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-muted-foreground">Adresa</p>
              <p className="leading-tight">{company?.address ?? "—"}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Změnu údajů proveďte v sekci Nastavení organizace
              {isOwner ? "" : " (vyžaduje roli vlastníka)."}
            </p>
          </CardContent>
        </Card>

        <Card className="min-w-0 border-dashed">
          <CardHeader>
            <CardTitle className="text-base">Platby</CardTitle>
            <CardDescription>
              Online platby předplatného v aplikaci nejsou k dispozici. Fakturaci řeší váš obchodní
              kontakt u poskytovatele platformy.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
