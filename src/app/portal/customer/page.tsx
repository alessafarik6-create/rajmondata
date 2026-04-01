"use client";

import React, { useEffect, useMemo } from "react";
import Link from "next/link";
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Briefcase, ChevronRight, Loader2, MessageSquare } from "lucide-react";
import { canCustomerAccessJob } from "@/lib/job-customer-access";

export default function CustomerPortalHomePage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading } = useDoc(userRef);

  const linkedJobIds = useMemo(() => {
    const raw = (profile as { linkedJobIds?: unknown } | null)?.linkedJobIds;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  }, [profile]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.log("customer linkedJobIds", linkedJobIds);
  }, [linkedJobIds]);

  if (!user || isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (profile && (profile as { role?: string }).role !== "customer") {
    return (
      <Card className="max-w-lg border-border">
        <CardHeader>
          <CardTitle>Přístup</CardTitle>
          <CardDescription>Tato sekce je určena účtům s rolí zákazník.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="portal-page-title">Přehled</h1>
        <p className="text-muted-foreground text-sm">
          Vítejte v klientském portálu. Zde najdete své zakázky a dokumenty, které vám firma zpřístupní.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Moje zakázky</CardTitle>
          <CardDescription>
            Počet přiřazených zakázek: {linkedJobIds.length}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/portal/customer/jobs" className="gap-2">
              <Briefcase className="h-4 w-4" />
              Zobrazit zakázky
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
      <Card className="border-emerald-300 bg-emerald-50">
        <CardHeader>
          <CardTitle className="text-lg text-emerald-900">Máte dotaz? Napište nám</CardTitle>
          <CardDescription className="text-emerald-800">
            Můžete nám poslat zprávu přímo z portálu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/portal/customer/chat" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Otevřít chat
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
