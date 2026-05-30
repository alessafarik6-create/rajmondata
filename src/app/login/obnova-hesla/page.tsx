"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useFirebase } from "@/firebase";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { PublicAuthPageLayout } from "@/components/auth/public-auth-page-layout";
import { PasswordInputField } from "@/components/auth/password-input-field";
import {
  PUBLIC_AUTH_CARD_CLASS,
  PUBLIC_AUTH_SUBMIT_BUTTON_CLASS,
} from "@/lib/public-auth-form-classes";
import {
  MIN_EMPLOYEE_PASSWORD_LENGTH,
  PASSWORD_MISMATCH_MESSAGE,
  hasNewPasswordFormErrors,
  validateNewPasswordForm,
} from "@/lib/new-password-form-validation";
import { confirmPasswordReset, type AuthError } from "firebase/auth";

function ObnovaHeslaCard({
  children,
  title,
  description,
}: {
  children: React.ReactNode;
  title: string;
  description: React.ReactNode;
}) {
  return (
    <Card className={PUBLIC_AUTH_CARD_CLASS}>
      <CardHeader className="space-y-3 text-center sm:space-y-4">
        <div className="mx-auto flex justify-center">
          <Logo context="page" compact />
        </div>
        <div className="space-y-1.5 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Obnova hesla
          </p>
          <CardTitle className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {title}
          </CardTitle>
          <CardDescription className="text-sm text-slate-600 sm:text-base">
            {description}
          </CardDescription>
        </div>
      </CardHeader>
      {children}
    </Card>
  );
}

function ObnovaHeslaContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { auth, areServicesAvailable, firebaseConfigError } = useFirebase();

  const oobCode = searchParams.get("oobCode");
  const mode = searchParams.get("mode");

  const linkLooksValid = useMemo(() => {
    if (!oobCode?.trim()) return false;
    if (mode && mode !== "resetPassword") return false;
    return true;
  }, [oobCode, mode]);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);

  const showInvalidState = !linkLooksValid || linkInvalid;

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => {
      router.push("/login");
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [success, router]);

  const canSubmit =
    !loading &&
    !showInvalidState &&
    !success &&
    password.trim().length > 0 &&
    confirm.trim().length > 0 &&
    !firebaseConfigError &&
    areServicesAvailable &&
    auth;

  const clearFieldError = (key: string) => {
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);

    const errors = validateNewPasswordForm({ password, confirm });
    const mapped: Record<string, string> = {};
    if (errors.password) mapped.password = errors.password;
    if (errors.confirm) mapped.confirm = errors.confirm;
    setFieldErrors(mapped);
    if (hasNewPasswordFormErrors(errors)) return;

    if (!auth || !oobCode) {
      setLinkInvalid(true);
      return;
    }

    setLoading(true);
    try {
      await confirmPasswordReset(auth, oobCode, password.trim());
      setSuccess(true);
    } catch (err) {
      const code = (err as AuthError)?.code;
      if (
        code === "auth/expired-action-code" ||
        code === "auth/invalid-action-code"
      ) {
        setLinkInvalid(true);
        return;
      }
      if (code === "auth/weak-password") {
        setFieldErrors({
          password: "Heslo je příliš slabé. Zvolte delší nebo složitější heslo.",
        });
        return;
      }
      setFormError("Nepodařilo se změnit heslo. Zkuste to znovu.");
    } finally {
      setLoading(false);
    }
  };

  if (showInvalidState) {
    return (
      <PublicAuthPageLayout
        mediaTitle="Obnova hesla"
        mediaSubtitle="Odkaz pro nastavení nového hesla k zákaznickému portálu."
      >
        <ObnovaHeslaCard
          title="Neplatný odkaz"
          description={
            <span className="text-destructive">
              Odkaz pro obnovu hesla je neplatný nebo již vypršel. Požádejte o nový e-mailem
              nebo u správce firmy.
            </span>
          }
        >
          <CardContent className="px-4 pb-6 sm:px-6 sm:pb-8">
            <Button asChild className={PUBLIC_AUTH_SUBMIT_BUTTON_CLASS}>
              <Link href="/login">Přejít na přihlášení</Link>
            </Button>
          </CardContent>
        </ObnovaHeslaCard>
      </PublicAuthPageLayout>
    );
  }

  if (success) {
    return (
      <PublicAuthPageLayout
        mediaTitle="Obnova hesla"
        mediaSubtitle="Heslo bylo úspěšně nastaveno."
      >
        <ObnovaHeslaCard
          title="Heslo bylo změněno"
          description="Nové heslo je uloženo. Za chvíli vás přesměrujeme na přihlášení."
        >
          <CardContent className="space-y-4 px-4 pb-6 sm:px-6 sm:pb-8">
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Heslo bylo úspěšně nastaveno. Použijte ho při příštím přihlášení do zákaznického
              portálu.
            </p>
            <Button asChild className={PUBLIC_AUTH_SUBMIT_BUTTON_CLASS}>
              <Link href="/login">Přihlásit se</Link>
            </Button>
          </CardContent>
        </ObnovaHeslaCard>
      </PublicAuthPageLayout>
    );
  }

  return (
    <PublicAuthPageLayout
      mediaTitle="Obnova hesla"
      mediaSubtitle="Nastavte si nové heslo pro přístup do zákaznického portálu."
    >
      <ObnovaHeslaCard
        title="Nové heslo"
        description="Zadejte nové heslo a potvrďte ho pro kontrolu."
      >
        <form onSubmit={(e) => void handleSubmit(e)}>
          <CardContent className="space-y-4 px-4 sm:px-6">
            {firebaseConfigError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {firebaseConfigError}
              </div>
            ) : !areServicesAvailable || !auth ? (
              <div className="rounded-md border border-orange-500/30 bg-orange-100 px-3 py-2 text-sm text-orange-800">
                Přihlašování se ještě načítá. Pokud stav trvá déle, obnovte stránku.
              </div>
            ) : null}

            {formError ? (
              <div
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {formError}
              </div>
            ) : null}

            <PasswordInputField
              id="new-password"
              label="Nové heslo"
              value={password}
              onChange={(v) => {
                setPassword(v);
                clearFieldError("password");
                if (fieldErrors.confirm === PASSWORD_MISMATCH_MESSAGE) clearFieldError("confirm");
              }}
              autoComplete="new-password"
              disabled={loading}
              minLength={MIN_EMPLOYEE_PASSWORD_LENGTH}
              placeholder={`Min. ${MIN_EMPLOYEE_PASSWORD_LENGTH} znaků`}
              error={fieldErrors.password}
              variant="publicAuth"
            />

            <PasswordInputField
              id="confirm-password"
              label="Potvrzení nového hesla"
              value={confirm}
              onChange={(v) => {
                setConfirm(v);
                clearFieldError("confirm");
              }}
              autoComplete="new-password"
              disabled={loading}
              minLength={MIN_EMPLOYEE_PASSWORD_LENGTH}
              error={fieldErrors.confirm}
              variant="publicAuth"
            />

            <Button type="submit" className={PUBLIC_AUTH_SUBMIT_BUTTON_CLASS} disabled={!canSubmit}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Ukládám…
                </>
              ) : (
                "Uložit nové heslo"
              )}
            </Button>

            <p className="text-center text-sm text-slate-600">
              <Link href="/login" className="text-orange-600 hover:underline">
                Zpět na přihlášení
              </Link>
            </p>
          </CardContent>
        </form>
      </ObnovaHeslaCard>
    </PublicAuthPageLayout>
  );
}

export default function ObnovaHeslaPage() {
  return (
    <Suspense
      fallback={
        <PublicAuthPageLayout mediaTitle="Obnova hesla" mediaSubtitle="Načítání…">
          <ObnovaHeslaCard title="Nové heslo" description="Načítání formuláře…">
            <CardContent className="flex justify-center px-4 py-8 sm:px-6">
              <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            </CardContent>
          </ObnovaHeslaCard>
        </PublicAuthPageLayout>
      }
    >
      <ObnovaHeslaContent />
    </Suspense>
  );
}
