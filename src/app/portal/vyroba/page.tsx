"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { Factory, Loader2, Plus } from "lucide-react";
import {
  useUser,
  useFirestore,
  useDoc,
  useCollection,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { hasActiveModuleAccess, isCompanyLicenseBlocking } from "@/lib/platform-access";
import { userCanAccessProductionPortal } from "@/lib/warehouse-production-access";
import { PRODUCTION_STATUS_LABELS, type ProductionRecordRow } from "@/lib/production-types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CARD = "border-slate-200 bg-white text-slate-900";

export default function VyrobaListPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const router = useRouter();
  const { company, companyId } = useCompany();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
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
    !isCompanyLicenseBlocking(company) &&
    hasActiveModuleAccess(company, "vyroba") &&
    userCanAccessProductionPortal({
      role,
      globalRoles: profile?.globalRoles,
      employeeRow: employeeRow as { canAccessProduction?: boolean } | null,
    });

  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(collection(firestore, "companies", companyId, "jobs"), limit(300));
  }, [firestore, companyId]);

  const prodQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "production"),
      orderBy("updatedAt", "desc"),
      limit(200)
    );
  }, [firestore, companyId]);

  const { data: jobs } = useCollection(jobsQuery);
  const { data: productions, isLoading } = useCollection(prodQuery);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [jobId, setJobId] = useState<string>("");

  const jobList = useMemo(() => (Array.isArray(jobs) ? jobs : []), [jobs]);
  const prodRows = useMemo(
    () => (Array.isArray(productions) ? (productions as ProductionRecordRow[]) : []),
    [productions]
  );

  const jobsModuleOn =
    company &&
    !isCompanyLicenseBlocking(company) &&
    hasActiveModuleAccess(company, "jobs");

  if (!user || !firestore || !companyId) {
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
          Nemáte přístup k výrobě nebo není modul aktivní.
          <div className="mt-4">
            <Button type="button" variant="outline" onClick={() => router.push("/portal/dashboard")}>
              Zpět na přehled
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const createProduction = async () => {
    if (!user) return;
    const t = title.trim();
    if (!t) {
      toast({ variant: "destructive", title: "Zadejte název výroby." });
      return;
    }
    setSaving(true);
    try {
      let jobName: string | null = null;
      if (jobId) {
        const j = jobList.find((x: any) => x.id === jobId);
        jobName =
          (j?.name as string) ||
          (j?.title as string) ||
          (j?.jobName as string) ||
          jobId;
      }
      const ref = await addDoc(collection(firestore, "companies", companyId, "production"), {
        companyId,
        title: t,
        jobId: jobId || null,
        jobName,
        status: "new",
        note: "",
        materials: [],
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Výroba založena" });
      setOpen(false);
      setTitle("");
      setJobId("");
      router.push(`/portal/vyroba/${ref.id}`);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Uložení se nezdařilo.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="portal-page-title text-xl sm:text-2xl md:text-3xl text-slate-900">Výroba</h1>
          <p className="portal-page-description text-slate-700 mt-1">
            Výrobní záznamy, zakázky, materiál ze skladu a podklady v detailu záznamu.
          </p>
        </div>
        <Button
          type="button"
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => setOpen(true)}
        >
          <Plus className="h-4 w-4" /> Nová výroba
        </Button>
      </div>

      <Card className={CARD}>
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-lg text-slate-900 flex items-center gap-2">
            <Factory className="h-5 w-5 text-primary" />
            Seznam výrob
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          {isLoading ? (
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          ) : prodRows.length === 0 ? (
            <p className="text-sm text-slate-600">Zatím žádné záznamy.</p>
          ) : (
            prodRows.map((p) => (
              <Link
                key={p.id}
                href={`/portal/vyroba/${p.id}`}
                className="block rounded-lg border border-slate-200 bg-slate-50/80 p-4 hover:border-primary/40 transition-colors"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{p.title}</span>
                  <Badge variant="outline">
                    {PRODUCTION_STATUS_LABELS[p.status] || p.status}
                  </Badge>
                </div>
                {p.jobName || p.jobId ? (
                  <p className="text-sm text-slate-600 mt-1">
                    Zakázka: {p.jobName || p.jobId}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500 mt-1">Bez přiřazené zakázky</p>
                )}
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md" data-portal-dialog>
          <DialogHeader>
            <DialogTitle>Nová výroba</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Název výroby</Label>
              <Input
                className="bg-white border-slate-200"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            {jobsModuleOn ? (
              <div className="space-y-1">
                <Label>Zakázka (volitelně)</Label>
                <Select value={jobId || "__none__"} onValueChange={(v) => setJobId(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="bg-white border-slate-200">
                    <SelectValue placeholder="Bez zakázky" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200 max-h-60">
                    <SelectItem value="__none__">Bez zakázky</SelectItem>
                    {jobList.map((j: any) => (
                      <SelectItem key={j.id} value={j.id}>
                        {(j.name || j.title || j.id) as string}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Modul zakázek není aktivní — výrobu můžete založit bez vazby na zakázku.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" disabled={saving} onClick={() => void createProduction()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Vytvořit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
