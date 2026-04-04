"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc } from "firebase/firestore";
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft } from "lucide-react";
import { canCustomerAccessJob } from "@/lib/job-customer-access";
import { catalogVisibleToCustomer } from "@/lib/customer-catalog-visibility";
import { CustomerCatalogDetailView } from "@/components/customer/customer-catalog-detail-view";
import type { ProductCatalogDoc } from "@/lib/product-catalogs";

export default function CustomerJobCatalogDetailPage() {
  const params = useParams();
  const jobIdRaw = params?.jobId;
  const catalogIdRaw = params?.catalogId;
  const jobId = Array.isArray(jobIdRaw) ? jobIdRaw[0] : jobIdRaw;
  const catalogId = Array.isArray(catalogIdRaw) ? catalogIdRaw[0] : catalogIdRaw;

  const { user } = useUser();
  const firestore = useFirestore();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: profile, isLoading: profileLoading } = useDoc(userRef);
  const companyId = (profile as { companyId?: string })?.companyId;
  const linkedJobIds = ((profile as { linkedJobIds?: string[] })?.linkedJobIds ?? []).filter(Boolean);
  const customerRecordId =
    typeof (profile as { customerRecordId?: string })?.customerRecordId === "string"
      ? (profile as { customerRecordId?: string }).customerRecordId
      : null;

  const jobRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId && typeof jobId === "string"
        ? doc(firestore, "companies", companyId, "jobs", jobId)
        : null,
    [firestore, companyId, jobId]
  );
  const { data: jobDoc, isLoading: jobLoading } = useDoc(jobRef);

  const catalogRef = useMemoFirebase(
    () =>
      firestore && companyId && catalogId && typeof catalogId === "string"
        ? doc(firestore, "companies", companyId, "product_catalogs", catalogId)
        : null,
    [firestore, companyId, catalogId]
  );
  const { data: catalogDoc, isLoading: catalogLoading } = useDoc(catalogRef);

  const catalog = useMemo(() => {
    if (!catalogDoc || !catalogId || typeof catalogId !== "string") return null;
    return { id: catalogId, ...(catalogDoc as Record<string, unknown>) } as {
      id: string;
    } & Partial<ProductCatalogDoc>;
  }, [catalogDoc, catalogId]);

  const accessAllowed = useMemo(() => {
    if (!user?.uid || !jobId || typeof jobId !== "string" || !jobDoc) return false;
    return canCustomerAccessJob(user.uid, profile as Parameters<typeof canCustomerAccessJob>[1], {
      ...(jobDoc as Record<string, unknown>),
      id: jobId,
    });
  }, [user?.uid, jobId, jobDoc, profile]);

  const catalogOk = useMemo(() => {
    if (!catalog) return false;
    return catalogVisibleToCustomer(catalog, { linkedJobIds, customerRecordId });
  }, [catalog, linkedJobIds, customerRecordId]);

  if (!user || profileLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if ((profile as { role?: string })?.role !== "customer") {
    return (
      <Alert>
        <AlertTitle>Přístup</AlertTitle>
        <AlertDescription>Nejste přihlášeni jako zákazník.</AlertDescription>
      </Alert>
    );
  }

  if (!companyId || !jobId || typeof jobId !== "string" || !catalogId || typeof catalogId !== "string") {
    return (
      <Alert>
        <AlertTitle>Chybí údaje</AlertTitle>
        <AlertDescription>Stránku nelze načíst.</AlertDescription>
      </Alert>
    );
  }

  if (jobLoading || catalogLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!accessAllowed) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-3 py-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/portal/customer/jobs" className="gap-1">
            <ChevronLeft className="h-4 w-4" />
            Moje zakázky
          </Link>
        </Button>
        <Alert>
          <AlertTitle>Přístup zamítnut</AlertTitle>
          <AlertDescription>K této zakázce nemáte oprávnění.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!catalog || !catalogOk) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-3 py-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/portal/customer/jobs/${jobId}`} className="gap-1">
            <ChevronLeft className="h-4 w-4" />
            Zakázka
          </Link>
        </Button>
        <Alert>
          <AlertTitle>Katalog nenalezen</AlertTitle>
          <AlertDescription>
            Tento katalog neexistuje nebo pro vás není dostupný.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <CustomerCatalogDetailView
      catalog={catalog}
      jobId={jobId}
      backHref={`/portal/customer/jobs/${jobId}`}
      backLabel="Zpět na zakázku"
    />
  );
}
