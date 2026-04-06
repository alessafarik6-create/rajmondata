"use client";

import React, { useEffect, useMemo } from "react";
import Link from "next/link";
import {
  useUser,
  useFirestore,
  useDoc,
  useMemoFirebase,
} from "@/firebase";
import { doc, getDoc } from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Loader2 } from "lucide-react";
import { canCustomerAccessJob } from "@/lib/job-customer-access";
import { Progress } from "@/components/ui/progress";
import { normalizeCompletionPercent } from "@/lib/job-customer-progress";

type JobRow = {
  id: string;
  name?: string;
  status?: string;
  endDate?: string;
  customerAddress?: string;
  completionPercent?: number;
};

export default function CustomerJobsListPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc(userRef);
  const companyId = (profile as { companyId?: string } | null)?.companyId;

  const linkedJobIds = useMemo(() => {
    const raw = (profile as { linkedJobIds?: unknown } | null)?.linkedJobIds;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  }, [profile]);

  const [jobs, setJobs] = React.useState<JobRow[]>([]);
  const [jobsLoading, setJobsLoading] = React.useState(true);

  React.useEffect(() => {
    if (!firestore || !companyId || !user?.uid || !profile) {
      setJobs([]);
      setJobsLoading(false);
      return;
    }
    if ((profile as { role?: string }).role !== "customer") {
      setJobsLoading(false);
      return;
    }
    let cancelled = false;
    setJobsLoading(true);
    void (async () => {
      const list: JobRow[] = [];
      for (const jid of linkedJobIds) {
        try {
          const ref = doc(firestore, "companies", companyId, "jobs", jid);
          const snap = await getDoc(ref);
          if (!snap.exists() || cancelled) continue;
          const data = snap.data() as Record<string, unknown>;
          const row: JobRow = {
            id: snap.id,
            name: typeof data.name === "string" ? data.name : "",
            status: typeof data.status === "string" ? data.status : "",
            endDate: typeof data.endDate === "string" ? data.endDate : "",
            customerAddress:
              typeof data.customerAddress === "string" ? data.customerAddress : "",
            completionPercent: normalizeCompletionPercent(data.completionPercent),
          };
          if (
            canCustomerAccessJob(user.uid, profile as Parameters<typeof canCustomerAccessJob>[1], {
              ...data,
              id: jid,
            })
          ) {
            list.push(row);
          }
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) {
        setJobs(list);
        if (process.env.NODE_ENV === "development") {
          console.log("loaded customer jobs", list);
        }
      }
      if (!cancelled) setJobsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, companyId, user?.uid, profile, linkedJobIds]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.log("customer linkedJobIds", linkedJobIds);
  }, [linkedJobIds]);

  if (!user || profileLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/portal/customer" className="gap-1">
            <ChevronLeft className="h-4 w-4" />
            Přehled
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="portal-page-title">Moje zakázky</h1>
        <p className="text-muted-foreground text-sm">
          Otevřete detail — uvidíte základní údaje a soubory, které vám administrátor zpřístupní.
        </p>
      </div>

      {jobsLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : jobs.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Žádná zakázka</CardTitle>
            <CardDescription>
              Nemáte přiřazenou žádnou zakázku, nebo synchronizace ještě neproběhla. Kontaktujte firmu.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <Card key={j.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{j.name?.trim() || j.id}</CardTitle>
                <CardDescription>
                  Stav: {j.status || "—"}
                  {j.endDate ? ` · Termín: ${j.endDate}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>Dokončení</span>
                    <span className="tabular-nums">{j.completionPercent ?? 0} %</span>
                  </div>
                  <Progress value={j.completionPercent ?? 0} className="h-2" />
                </div>
                <Button asChild size="sm">
                  <Link href={`/portal/customer/jobs/${j.id}`}>Otevřít detail</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
