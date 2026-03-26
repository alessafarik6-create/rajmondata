"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import {
  useUser,
  useDoc,
  useMemoFirebase,
  useFirestore,
} from "@/firebase";
import { doc } from "firebase/firestore";
import { useCompany } from "@/firebase/firestore/use-company";
import { CompanyChat } from "@/components/chat/CompanyChat";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEmployeeUiLang } from "@/hooks/use-employee-ui-lang";

export default function EmployeeMessagesPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const {
    companyId,
    isLoading: companyLoading,
    companyDocMissing,
  } = useCompany();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile } = useDoc<any>(userRef);
  const { t } = useEmployeeUiLang(profile);

  if (companyLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-slate-800">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="text-sm">{t("loadingProfile")}</span>
      </div>
    );
  }

  if (companyDocMissing) {
    return (
      <Alert variant="destructive" className="max-w-lg border-destructive/60">
        <AlertTitle>Firma neexistuje</AlertTitle>
        <AlertDescription>
          Dokument organizace ve Firestore chybí. Kontaktujte administrátora nebo podporu.
        </AlertDescription>
      </Alert>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-lg border-amber-200 bg-amber-50 text-amber-950">
        <AlertTitle>Chybí organizace</AlertTitle>
        <AlertDescription>
          Nelze otevřít zprávy bez přiřazení k firmě.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto">
      <div>
        <h1 className="portal-page-title text-2xl sm:text-3xl">{t("messages")}</h1>
        <p className="portal-page-description mt-1 text-base text-slate-800">
          {t("messagesSubtitle")}
        </p>
      </div>
      <CompanyChat
        companyId={companyId}
        mode="employee"
        title={t("messages")}
        placeholder={
          profile?.language === "ua"
            ? "Повідомлення адміністратору…"
            : "Zpráva administrátorovi…"
        }
      />
    </div>
  );
}
