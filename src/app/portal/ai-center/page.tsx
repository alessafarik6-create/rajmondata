"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { useUser, useDoc, useMemoFirebase, useCompany, useFirestore } from "@/firebase";
import { doc } from "firebase/firestore";
import { AiCenterContent } from "@/components/ai-center/ai-center-content";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AiCenterPage() {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { companyId } = useCompany();

  const userRef = useMemoFirebase(
    () => (firestore && user ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc(userRef);

  const isAdmin =
    profile?.role === "owner" ||
    profile?.role === "admin" ||
    profile?.globalRoles?.includes("super_admin");

  const resolvedCompanyId = companyId || String(profile?.companyId ?? "").trim();

  if (isUserLoading || profileLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <Card className="max-w-lg mx-auto mt-8">
        <CardContent className="pt-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            AI centrum je dostupné pouze pro administrátory organizace (owner/admin).
          </p>
          <Button variant="outline" asChild>
            <Link href="/portal/dashboard">Zpět na přehled</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!resolvedCompanyId) {
    return (
      <Card className="max-w-lg mx-auto mt-8">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Chybí přiřazená organizace.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="container max-w-6xl py-6 px-4">
      <AiCenterContent companyId={resolvedCompanyId} />
    </div>
  );
}
