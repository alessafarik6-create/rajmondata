"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { collection, doc, query } from "firebase/firestore";
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { catalogIsAssignedToJob, type ProductCatalogDoc } from "@/lib/product-catalogs";

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
  const catalogsRef = useMemoFirebase(
    () => (firestore && companyId ? query(collection(firestore, "companies", companyId, "product_catalogs")) : null),
    [firestore, companyId]
  );
  const { data: catalogsData } = useCollection(catalogsRef);

  const assigned = useMemo(() => {
    const rows = (catalogsData ?? []) as Array<{ id: string } & Partial<ProductCatalogDoc>>;
    return rows.filter(
      (c) =>
        c.active !== false &&
        c.customerVisible === true &&
        linkedJobIds.some((jobId) => catalogIsAssignedToJob(c, jobId))
    );
  }, [catalogsData, linkedJobIds]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-6">
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
            assigned.map((c) => (
              <div key={c.id} className="rounded border p-3">
                <p className="font-medium">{c.name || "Katalog"}</p>
                <p className="text-xs text-muted-foreground">{c.description || "Bez popisu"}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(c.assignedJobIds ?? [])
                    .filter((id) => linkedJobIds.includes(id))
                    .map((jobId) => (
                      <Button key={jobId} asChild size="sm" variant="outline">
                        <Link href={`/portal/customer/jobs/${jobId}`}>Otevřít výběr v zakázce</Link>
                      </Button>
                    ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

