"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { collection, doc, query } from "firebase/firestore";
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { catalogVisibleToCustomer } from "@/lib/customer-catalog-visibility";
import type { ProductCatalogDoc } from "@/lib/product-catalogs";
import { CustomerCatalogCompactRow } from "@/components/customer/customer-catalog-ui";

export default function CustomerCatalogsPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc(userRef);
  const companyId = (profile as { companyId?: string })?.companyId;
  const linkedJobIds = ((profile as { linkedJobIds?: string[] })?.linkedJobIds ?? []).filter(Boolean);
  const customerRecordId =
    typeof (profile as { customerRecordId?: string })?.customerRecordId === "string"
      ? (profile as { customerRecordId?: string }).customerRecordId
      : null;

  const catalogsRef = useMemoFirebase(
    () => (firestore && companyId ? query(collection(firestore, "companies", companyId, "product_catalogs")) : null),
    [firestore, companyId]
  );
  const { data: catalogsData } = useCollection(catalogsRef);

  const jobsRef = useMemoFirebase(
    () =>
      firestore && companyId && linkedJobIds.length
        ? query(collection(firestore, "companies", companyId, "jobs"))
        : null,
    [firestore, companyId, linkedJobIds.length]
  );
  const { data: jobsData } = useCollection(jobsRef);

  const jobsById = useMemo(() => {
    const m = new Map<string, { id: string; name?: string }>();
    for (const j of jobsData ?? []) {
      m.set(j.id, j as { id: string; name?: string });
    }
    return m;
  }, [jobsData]);

  const assigned = useMemo(() => {
    const rows = (catalogsData ?? []) as Array<{ id: string } & Partial<ProductCatalogDoc>>;
    return rows
      .filter((c) => catalogVisibleToCustomer(c, { linkedJobIds, customerRecordId }))
      .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || String(a.name ?? "").localeCompare(String(b.name ?? ""), "cs"));
  }, [catalogsData, linkedJobIds, customerRecordId]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-3 py-6 sm:px-4">
      <Card>
        <CardHeader>
          <CardTitle>Katalog produktů</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!assigned.length ? (
            <p className="text-sm text-muted-foreground">
              Zatím pro vás nejsou připravené žádné produktové katalogy.
            </p>
          ) : (
            <ul className="space-y-2">
              {assigned.map((c) => {
                const detailHref = `/portal/customer/catalogs/${c.id}`;
                const jobLinks = (c.assignedJobIds ?? []).filter((id) => linkedJobIds.includes(id));
                return (
                  <li key={c.id} className="space-y-2">
                    <CustomerCatalogCompactRow href={detailHref} catalog={c} />
                    {jobLinks.length ? (
                      <div className="flex flex-wrap gap-2 pl-1">
                        {jobLinks.map((jobId) => (
                          <Button key={jobId} asChild size="sm" variant="outline" className="text-xs">
                            <Link href={`/portal/customer/jobs/${jobId}`}>
                              Výběr v zakázce: {jobsById.get(jobId)?.name?.trim() || jobId}
                            </Link>
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
