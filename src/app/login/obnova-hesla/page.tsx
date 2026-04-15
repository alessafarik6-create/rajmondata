"use client";

import React, { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useFirebase } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { PLATFORM_NAME } from "@/lib/platform-brand";
import { confirmPasswordReset, type AuthError } from "firebase/auth";

function AuthPageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="relative hidden bg-black lg:block">
        <Image
          src="https://picsum.photos/seed/rajmondata-login/1200/1200"
          alt="Pozadí přihlášení"
          fill
          className="object-cover opacity-50"
          data-ai-hint="dark abstract orange"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
        <div className="absolute bottom-12 left-12 right-12">
          <h1 className="mb-4 text-4xl font-bold text-white">
            Posílení podnikání s {PLATFORM_NAME}.
          </h1>
          <p className="text-xl text-muted-foreground">
            Komplexní platforma pro správu firem a provozní dokonalost v
            multi-tenant prostředí.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center bg-background p-8 text-foreground">
        {children}
      </div>
    </div>
  );
}

const INPUT_CLASS =
  "border-border bg-background text-foreground pr-10";

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  show,
  onToggleShow,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  show: boolean;
  onToggleShow: () => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLASS}
          autoComplete={autoComplete}
          required
          disabled={disabled}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={onToggleShow}
          disabled={disabled}
          aria-label={show ? "Skrýt heslo" : "Zobrazit heslo"}
        >
          {show ? (
            <EyeOff className="h-4 w-4" aria-hidden />
          ) : (
            <Eye className="h-4 w-4" aria-hidden />
          )}
        </Button>
      </div>
    </div>
  );
}

function ObnovaHeslaContent() {
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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mismatchError, setMismatchError] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);

  const showInvalidState = !linkLooksValid || linkInvalid;

  const canSubmit =
    !loading &&
    !showInvalidState &&
    !success &&
    password.length > 0 &&
    confirm.length > 0 &&
    !firebaseConfigError &&
    areServicesAvailable &&
    auth;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError(null);
    setMismatchError(false);

    if (!password.trim() || !confirm.trim()) {
      return;
    }

    if (password !== confirm) {
      setMismatchError(true);
      return;
    }

    if (!auth || !oobCode) {
      setLinkInvalid(true);
      return;
    }

    setLoading(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
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
        setSubmitError(
          "Heslo je příliš slabé. Zvolte delší nebo složitější heslo."
        );
        return;
      }
      setSubmitError("Nepodařilo se změnit heslo. Zkuste to znovu.");
    } finally {
      setLoading(false);
    }
  };

  if (showInvalidState) {
    return (
      <AuthPageShell>
        <Card className="w-full max-w-md border-border bg-surface shadow-2xl">
          <CardHeader className="space-y-4 text-center">
            <div className="mx-auto flex justify-center">
              <Logo context="page" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-3xl font-bold tracking-tight text-foreground">
                Nastavení nového hesla
              </CardTitle>
              <CardDescription className="text-destructive">
                Odkaz pro obnovu hesla je neplatný nebo již vypršel.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Button
              asChild
              className="h-11 w-full bg-primary text-lg font-semibold text-white hover:bg-primary/90"
            >
              <Link href="/login">Přejít na přihlášení</Link>
            </Button>
          </CardContent>
        </Card>
      </AuthPageShell>
    );
  }

  if (success) {
    return (
      <AuthPageShell>
        <Card className="w-full max-w-md border-border bg-surface shadow-2xl">
          <CardHeader className="space-y-4 text-center">
            <div className="mx-auto flex justify-center">
              <Logo context="page" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-3xl font-bold tracking-tight text-foreground">
                Nastavení nového hesla
              </CardTitle>
              <CardDescription className="text-foreground">
                Heslo bylo úspěšně změněno.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Button
              asChild
              className="h-11 w-full bg-primary text-lg font-semibold text-white hover:bg-primary/90"
            >
              <Link href="/login">Přejít na přihlášení</Link>
            </Button>
          </CardContent>
        </Card>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell>
      <Card className="w-full max-w-md border-border bg-surface shadow-2xl">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex justify-center">
            <Logo context="page" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-3xl font-bold tracking-tight text-foreground">
              Nastavení nového hesla
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Zadejte nové heslo pro svůj účet.
            </CardDescription>
          </div>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {firebaseConfigError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {firebaseConfigError}
              </div>
            ) : !areServicesAvailable || !auth ? (
              <div className="rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm text-orange-600">
                Přihlašování se ještě načítá. Pokud stav trvá déle, obnovte
                stránku.
              </div>
            ) : null}

            {mismatchError ? (
              <div
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                Hesla se neshodují.
              </div>
            ) : null}

            {submitError ? (
              <div
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {submitError}
              </div>
            ) : null}

            <PasswordField
              id="new-password"
              label="Nové heslo"
              value={password}
              onChange={(v) => {
                setPassword(v);
                setMismatchError(false);
              }}
              autoComplete="new-password"
              show={showPassword}
              onToggleShow={() => setShowPassword((s) => !s)}
              disabled={loading}
            />

            <PasswordField
              id="confirm-password"
              label="Potvrzení nového hesla"
              value={confirm}
              onChange={(v) => {
                setConfirm(v);
                setMismatchError(false);
              }}
              autoComplete="new-password"
              show={showConfirm}
              onToggleShow={() => setShowConfirm((s) => !s)}
              disabled={loading}
            />

            <Button
              type="submit"
              className="h-11 w-full bg-primary text-lg font-semibold text-white hover:bg-primary/90"
              disabled={!canSubmit}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Ukládám...
                </>
              ) : (
                "Uložit nové heslo"
              )}
            </Button>
          </CardContent>
        </form>
      </Card>
    </AuthPageShell>
  );
}

export default function ObnovaHeslaPage() {
  return (
    <Suspense
      fallback={
        <AuthPageShell>
          <Card className="w-full max-w-md border-border bg-surface shadow-2xl">
            <CardHeader className="space-y-4 text-center">
              <div className="mx-auto flex justify-center">
                <Logo context="page" />
              </div>
              <CardTitle className="text-3xl font-bold tracking-tight text-foreground">
                Nastavení nového hesla
              </CardTitle>
              <CardDescription>Načítání…</CardDescription>
            </CardHeader>
          </Card>
        </AuthPageShell>
      }
    >
      <ObnovaHeslaContent />
    </Suspense>
  );
}
