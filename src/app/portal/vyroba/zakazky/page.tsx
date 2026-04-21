"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Factory, Loader2 } from "lucide-react";
import { useUser, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { useFirestore } from "@/firebase";
import { useCompany } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { canAccessCompanyModule } from "@/lib/platform-access";
import { useMergedPlatformModuleCatalog } from "@/contexts/platform-module-catalog-context";
import { userCanAccessProductionPortal } from "@/lib/warehouse-production-access";
import { isCompanyPrivileged } from "@/lib/company-privilege";

const CARD = "border-slate-200 bg-white text-slate-900";

type SafeJob = {
  jobId: string;
  name?: string;
  status?: string;
  displayLabel?: string;
  productionStatusNote?: string | null;
  productionWorkflowStatus?: string;
  productionWorkflowStatusLabel?: string;
};

export default function VyrobaZakazkyListPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const router = useRouter();
  const { company, companyId } = useCompany();
  const platformCatalog = useMergedPlatformModuleCatalog();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile } = useDoc<any>(userRef);
  const role = String(profile?.role || "employee");

  const employeeRef = useMemoFirebase(
    () =>
      firestore && companyId && profile?.employeeId && role === "employee"
        ? doc(firestore, "companies", companyId, "employees", String(profile.employeeId))
        : null,
    [firestore, companyId, profile?.employeeId, role]
  );
  const { data: employeeRow } = useDoc(employeeRef);

  const accessOk =
    company &&
    canAccessCompanyModule(company, "vyroba", platformCatalog) &&
    userCanAccessProductionPortal({
      role,
      globalRoles: profile?.globalRoles,
      employeeRow: employeeRow as { canAccessProduction?: boolean } | null,
    });

  const [jobs, setJobs] = useState<SafeJob[]>([]);
  const [loading, setLoading] = useState(true);

  const globalRoles = Array.isArray(profile?.globalRoles)
    ? profile.globalRoles.map((x: unknown) => String(x))
    : [];
  const privileged = isCompanyPrivileged(role, globalRoles);

  useEffect(() => {
    if (!user || !accessOk) {
      setLoading(false);
      return;
    }
    if (!privileged && role !== "employee") {
      setJobs([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const url = privileged
          ? "/api/company/production/team-jobs"
          : "/api/company/production/my-jobs";
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Nelze načíst zakázky.");
        }
        const list = Array.isArray(data.jobs) ? data.jobs : [];
        if (!cancelled) setJobs(list as SafeJob[]);
      } catch (e) {
        if (!cancelled) {
          toast({
            variant: "destructive",
            title: "Chyba",
            description: e instanceof Error ? e.message : "Načtení se nezdařilo.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, accessOk, role, privileged, toast]);

  if (!user || !companyId) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!accessOk) {
    return (
      <Card className={CARD}>
        <CardContent className="py-10 text-center text-slate-700">
          Nemáte přístup k výrobě.
          <div className="mt-4">
            <Button type="button" variant="outline" onClick={() => router.push("/portal/dashboard")}>
              Zpět
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!privileged && role !== "employee") {
    return (
      <Card className={CARD}>
        <CardContent className="py-10 text-center text-slate-700 space-y-3">
          <p>Tento přehled je dostupný zaměstnancům s přístupem k výrobě nebo vedení organizace.</p>
          <Button type="button" variant="outline" asChild>
            <Link href="/portal/jobs">Správa zakázek</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="portal-page-title text-xl sm:text-2xl md:text-3xl text-slate-900">
          Zakázky ve výrobě
        </h1>
        <p className="portal-page-description text-slate-700 mt-1">
          {privileged
            ? "Přehled zakázek s výrobním týmem nebo aktivní výrobou — bez obchodních cen a dokladů."
            : "Zakázky přiřazené vám pro realizaci — bez obchodních cen a dokladů."}
        </p>
      </div>

      <Card className={CARD}>
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-lg text-slate-900 flex items-center gap-2">
            <Factory className="h-5 w-5 text-primary" />
            {privileged ? "Výrobní zakázky" : "Moje přiřazení"}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          {loading ? (
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          ) : jobs.length === 0 ? (
            <p className="text-sm text-slate-600">Zatím nemáte přiřazenou žádnou zakázku ve výrobě.</p>
          ) : (
            jobs.map((j) => (
              <Link
                key={j.jobId}
                href={`/portal/vyroba/zakazky/${j.jobId}`}
                className="block rounded-lg border border-slate-200 bg-slate-50/80 p-4 hover:border-primary/40 transition-colors"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">
                    {j.displayLabel || j.name || j.jobId}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {j.productionWorkflowStatusLabel ? (
                      <Badge variant="secondary">{j.productionWorkflowStatusLabel}</Badge>
                    ) : null}
                    {j.status ? (
                      <Badge variant="outline" className="capitalize">
                        {j.status}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                {j.productionStatusNote ? (
                  <p className="text-xs text-slate-600 mt-2">{j.productionStatusNote}</p>
                ) : null}
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
