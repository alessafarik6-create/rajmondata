"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  type User,
} from "firebase/auth";
import { useUser, useAuth, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronLeft, KeyRound, Loader2 } from "lucide-react";
import { CustomerChatPanel } from "@/components/customer/customer-chat-panel";
import { CustomerLinkedJobsProgress } from "@/components/customer/customer-linked-jobs-progress";
import { CustomerProfileMeetingRecords } from "@/components/meeting-records/customer-profile-meeting-records";
import { useToast } from "@/hooks/use-toast";
import { MIN_EMPLOYEE_PASSWORD_LENGTH } from "@/lib/employee-password-policy";
import { mapFirebaseAuthPasswordChangeError } from "@/lib/firebase-auth-password-errors";
import { cn } from "@/lib/utils";

function hasEmailPasswordProvider(user: User | null | undefined): boolean {
  if (!user?.providerData?.length) return false;
  return user.providerData.some((p) => p.providerId === "password");
}

export default function CustomerProfilePage() {
  const { user } = useUser();
  const auth = useAuth();
  const { toast } = useToast();
  const firestore = useFirestore();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading } = useDoc(userRef);
  const companyId = (profile as { companyId?: string })?.companyId;
  const linkedJobIds = ((profile as { linkedJobIds?: string[] })?.linkedJobIds ?? []).filter(Boolean);
  const defaultJobId = linkedJobIds[0] ?? null;

  const [pwdCurrent, setPwdCurrent] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdLoading, setPwdLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const canChangePassword = useMemo(() => {
    if (!user?.email?.trim()) return false;
    return hasEmailPasswordProvider(user);
  }, [user]);

  const clearFieldError = (key: string) => {
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const validatePasswordForm = (): boolean => {
    const e: Record<string, string> = {};
    if (!pwdCurrent) {
      e.current = "Vyplňte aktuální heslo.";
    }
    if (!pwdNew) {
      e.new = "Vyplňte nové heslo.";
    } else if (pwdNew.length < MIN_EMPLOYEE_PASSWORD_LENGTH) {
      e.new = `Nové heslo musí mít alespoň ${MIN_EMPLOYEE_PASSWORD_LENGTH} znaků.`;
    }
    if (!pwdConfirm) {
      e.confirm = "Potvrďte nové heslo.";
    } else if (pwdNew !== pwdConfirm) {
      e.confirm = "Nové heslo a potvrzení se neshodují.";
    }
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email || !auth || !canChangePassword) return;
    if (!validatePasswordForm()) return;

    setPwdLoading(true);
    try {
      const cred = EmailAuthProvider.credential(user.email, pwdCurrent);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, pwdNew);
      setPwdCurrent("");
      setPwdNew("");
      setPwdConfirm("");
      setFieldErrors({});
      toast({
        title: "Heslo bylo změněno",
        description: "Od příštího přihlášení použijte nové heslo.",
      });
    } catch (err: unknown) {
      console.error("[customer/profile] password change", err);
      toast({
        variant: "destructive",
        title: "Změna hesla se nezdařila",
        description: mapFirebaseAuthPasswordChangeError(err),
      });
    } finally {
      setPwdLoading(false);
    }
  };

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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 shrink-0" />
            Změna hesla
          </CardTitle>
          <CardDescription>
            Pro kontrolu zadejte současné heslo. Nové heslo se ukládá pouze do Firebase Authentication,
            nikam jinam se neposílá.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!canChangePassword ? (
            <p className="text-sm text-muted-foreground">
              {user.email
                ? "Změna hesla v tomto formuláři je dostupná jen u účtu přihlášeného e-mailem a heslem. U přihlášení přes Google (nebo jiný poskytovatel) použijte správu účtu u dané služby, případně si nechte správce firmy zřídit heslo k e-mailu."
                : "Účet nemá e-mail pro ověření — kontaktujte správce firmy."}
            </p>
          ) : (
            <form onSubmit={(ev) => void handlePasswordChange(ev)} className="grid max-w-md gap-4">
              <div className="space-y-2">
                <Label htmlFor="cust-pwd-current">Aktuální heslo</Label>
                <Input
                  id="cust-pwd-current"
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  value={pwdCurrent}
                  onChange={(ev) => {
                    setPwdCurrent(ev.target.value);
                    clearFieldError("current");
                  }}
                  disabled={pwdLoading}
                  className={cn(fieldErrors.current && "border-destructive")}
                  aria-invalid={Boolean(fieldErrors.current)}
                  aria-describedby={fieldErrors.current ? "cust-pwd-current-err" : undefined}
                />
                {fieldErrors.current ? (
                  <p id="cust-pwd-current-err" className="text-sm text-destructive">
                    {fieldErrors.current}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cust-pwd-new">Nové heslo</Label>
                <Input
                  id="cust-pwd-new"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={pwdNew}
                  onChange={(ev) => {
                    setPwdNew(ev.target.value);
                    clearFieldError("new");
                  }}
                  disabled={pwdLoading}
                  className={cn(fieldErrors.new && "border-destructive")}
                  aria-invalid={Boolean(fieldErrors.new)}
                  aria-describedby={fieldErrors.new ? "cust-pwd-new-err" : undefined}
                />
                {fieldErrors.new ? (
                  <p id="cust-pwd-new-err" className="text-sm text-destructive">
                    {fieldErrors.new}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Minimálně {MIN_EMPLOYEE_PASSWORD_LENGTH} znaků (stejná pravidla jako u zaměstnanců portálu).
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cust-pwd-confirm">Potvrzení nového hesla</Label>
                <Input
                  id="cust-pwd-confirm"
                  name="newPasswordConfirm"
                  type="password"
                  autoComplete="new-password"
                  value={pwdConfirm}
                  onChange={(ev) => {
                    setPwdConfirm(ev.target.value);
                    clearFieldError("confirm");
                  }}
                  disabled={pwdLoading}
                  className={cn(fieldErrors.confirm && "border-destructive")}
                  aria-invalid={Boolean(fieldErrors.confirm)}
                  aria-describedby={fieldErrors.confirm ? "cust-pwd-confirm-err" : undefined}
                />
                {fieldErrors.confirm ? (
                  <p id="cust-pwd-confirm-err" className="text-sm text-destructive">
                    {fieldErrors.confirm}
                  </p>
                ) : null}
              </div>
              <Button type="submit" disabled={pwdLoading} className="w-full sm:w-auto">
                {pwdLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Ukládám…
                  </>
                ) : (
                  "Změnit heslo"
                )}
              </Button>
            </form>
          )}
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

      {firestore && companyId && linkedJobIds.length > 0 ? (
        <CustomerProfileMeetingRecords
          firestore={firestore}
          companyId={companyId}
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
