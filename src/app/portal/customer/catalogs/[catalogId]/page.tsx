"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc } from "firebase/firestore";
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft } from "lucide-react";
import { catalogVisibleToCustomer } from "@/lib/customer-catalog-visibility";
import { CustomerCatalogDetailView } from "@/components/customer/customer-catalog-detail-view";
import type { ProductCatalogDoc } from "@/lib/product-catalogs";

export default function CustomerGlobalCatalogDetailPage() {
  const params = useParams();
  const catalogIdRaw = params?.catalogId;
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

  if (!companyId || !catalogId || typeof catalogId !== "string") {
    return (
      <Alert>
        <AlertTitle>Chybí údaje</AlertTitle>
        <AlertDescription>Stránku nelze načíst.</AlertDescription>
      </Alert>
    );
  }

  if (catalogLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!catalog || !catalogOk) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-3 py-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/portal/customer/catalogs" className="gap-1">
            <ChevronLeft className="h-4 w-4" />
            Katalogy
          </Link>
        </Button>
        <Alert>
          <AlertTitle>Katalog nenalezen</AlertTitle>
          <AlertDescription>Tento katalog pro vás není dostupný.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <CustomerCatalogDetailView
      catalog={catalog}
      jobId={null}
      backHref="/portal/customer/catalogs"
      backLabel="Zpět na katalogy"
    />
  );
}
