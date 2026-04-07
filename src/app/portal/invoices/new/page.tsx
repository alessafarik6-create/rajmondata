"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { PortalManualInvoiceForm } from "@/components/invoices/portal-manual-invoice-form";

export default function NewInvoicePage() {
  const router = useRouter();
  const { user } = useUser();
  const firestore = useFirestore();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);
  const companyId = profile?.companyId as string | undefined;

  if (isProfileLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!companyId || !user?.uid || !firestore) {
    return (
      <Alert className="max-w-xl border-slate-200 bg-slate-50">
        <AlertTitle>Není vybraná firma</AlertTitle>
        <AlertDescription>
          Novou fakturu můžete vystavit až po přiřazení k organizaci.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/portal/documents?view=issued")}>
          <ChevronLeft className="h-6 w-6" />
        </Button>
        <h1 className="portal-page-title">Vytvořit novou fakturu</h1>
      </div>

      <PortalManualInvoiceForm
        firestore={firestore}
        companyId={companyId}
        userId={user.uid}
        mode="create"
      />
    </div>
  );
}
