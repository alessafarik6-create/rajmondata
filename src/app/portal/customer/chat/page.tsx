"use client";

import React from "react";
import Link from "next/link";
import { ChevronLeft, Loader2 } from "lucide-react";
import { doc } from "firebase/firestore";
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CustomerChatPanel } from "@/components/customer/customer-chat-panel";

export default function CustomerChatPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: profile, isLoading } = useDoc(userRef);
  const companyId = (profile as { companyId?: string })?.companyId;
  const linkedJobId = ((profile as { linkedJobIds?: string[] })?.linkedJobIds ?? [])[0] ?? null;
  const params = {};
  if (process.env.NODE_ENV === "development") {
    console.log("customer chat route params", params);
    console.log("customer chat context", {
      customerId: null,
      customerUserId: user?.uid,
      jobId: linkedJobId,
      conversationId: user ? `cust_${user.uid}` : null,
    });
    console.log("redirect reason", isLoading ? "loading" : !companyId ? "missing_companyId" : null);
  }

  if (!user || isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if ((profile as { role?: string })?.role !== "customer") {
    return (
      <Alert>
        <AlertTitle>Přístup</AlertTitle>
        <AlertDescription>Chat je dostupný jen pro zákaznický portál.</AlertDescription>
      </Alert>
    );
  }
  if (!companyId) {
    return (
      <Alert>
        <AlertTitle>Chybí firma</AlertTitle>
        <AlertDescription>V profilu chybí companyId.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-3 py-4">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/portal/customer/profile" className="gap-1">
          <ChevronLeft className="h-4 w-4" />
          Profil
        </Link>
      </Button>
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
        <p className="text-base font-semibold text-emerald-900">Máte dotaz? Napište nám</p>
        <p className="text-sm text-emerald-800">Jsme tu pro vás přímo v klientském portálu.</p>
      </div>
      <CustomerChatPanel companyId={companyId} linkedJobId={linkedJobId} />
    </div>
  );
}

