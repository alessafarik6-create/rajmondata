"use client";

import React from "react";
import Link from "next/link";
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Loader2 } from "lucide-react";
import { CustomerChatPanel } from "@/components/customer/customer-chat-panel";
import { CustomerLinkedJobsProgress } from "@/components/customer/customer-linked-jobs-progress";

export default function CustomerProfilePage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading } = useDoc(userRef);
  const companyId = (profile as { companyId?: string })?.companyId;
  const linkedJobIds = ((profile as { linkedJobIds?: string[] })?.linkedJobIds ?? []).filter(Boolean);
  const defaultJobId = linkedJobIds[0] ?? null;

  if (!user || isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const email = user.email || (profile as { email?: string })?.email || "—";
  const name =
    (profile as { displayName?: string })?.displayName ||
    `${(profile as { firstName?: string }).firstName || ""} ${(profile as { lastName?: string }).lastName || ""}`.trim() ||
    "—";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/portal/customer" className="gap-1">
          <ChevronLeft className="h-4 w-4" />
          Přehled
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Profil</CardTitle>
          <CardDescription>Údaje vašeho účtu v klientském portálu.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">Jméno:</span> {name}
          </p>
          <p>
            <span className="text-muted-foreground">E-mail:</span>{" "}
            <span className="select-all font-mono text-xs">{email}</span>
          </p>
          <p className="text-xs text-muted-foreground pt-2">
            Změnu hesla provedete přes „Zapomenuté heslo“ na přihlašovací stránce (odhlásíte se a použijete
            obnovení hesla), nebo vás může správce firmy provést z administrace zákazníka.
          </p>
        </CardContent>
      </Card>

      {user && profile && companyId ? (
        <CustomerLinkedJobsProgress
          firestore={firestore}
          companyId={companyId}
          customerUid={user.uid}
          profile={profile}
          linkedJobIds={linkedJobIds}
        />
      ) : null}

      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
        <p className="text-base font-semibold text-emerald-900">Máte dotaz? Napište nám</p>
        <p className="text-sm text-emerald-800">Můžete nám poslat zprávu přímo z portálu.</p>
        <Button asChild className="mt-3">
          <Link href="/portal/customer/chat">Otevřít chat</Link>
        </Button>
      </div>
      {companyId ? (
        <CustomerChatPanel companyId={companyId} linkedJobId={defaultJobId} compact />
      ) : (
      <Card>
        <CardHeader>
          <CardTitle>Chat s administrací</CardTitle>
          <CardDescription>Napište zprávu správci firmy.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Chat není dostupný – chybí companyId.</p>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
