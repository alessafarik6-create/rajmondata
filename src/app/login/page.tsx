"use client";

import React, { useMemo, useState } from "react";
import { useFirebase } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, UserPlus, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { PLATFORM_NAME } from "@/lib/platform-brand";
import Image from "next/image";
import Link from "next/link";
import {
  AuthError,
  browserLocalPersistence,
  browserSessionPersistence,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { useToast } from "@/hooks/use-toast";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function LoginPage() {
  const { auth, areServicesAvailable } = useFirebase();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const normalizedEmail = useMemo(() => normalizeEmail(email), [email]);

  const isMobileBrowser = () => {
    if (typeof window === "undefined") return false;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  };

  const canSubmit =
    !loading && normalizedEmail.length > 0 && password.length > 0;

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!normalizedEmail || !password) {
      toast({
        variant: "destructive",
        title: "Chybějící údaje",
        description: "Prosím zadejte email i heslo.",
      });
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      toast({
        variant: "destructive",
        title: "Neplatný email",
        description: "Zadejte email ve správném formátu.",
      });
      return;
    }

    if (!auth || !areServicesAvailable) {
      toast({
        variant: "destructive",
        title: "Přihlášení není připravené",
        description:
          "Firebase se ještě nenačetl. Obnovte stránku a zkuste to znovu za chvíli.",
      });
      return;
    }

    setLoading(true);

    try {
      await setPersistence(
        auth,
        isMobileBrowser() ? browserLocalPersistence : browserSessionPersistence
      );

      await signInWithEmailAndPassword(auth, normalizedEmail, password);

      toast({
        title: "Přihlášení úspěšné",
        description: `Vítejte zpět v ${PLATFORM_NAME}.`,
      });

      window.location.assign("/portal/dashboard");
      return;
    } catch (error) {
      console.error("[LoginPage] login failed", error);

      const authError = error as AuthError;
      let description = "Neplatný email nebo heslo.";

      switch (authError?.code) {
        case "auth/invalid-email":
          description = "Email nemá správný formát.";
          break;
        case "auth/user-disabled":
          description = "Tento účet je zakázán.";
          break;
        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-credential":
          description = "Neplatný email nebo heslo.";
          break;
        case "auth/too-many-requests":
          description =
            "Příliš mnoho pokusů o přihlášení. Zkuste to znovu za chvíli.";
          break;
        case "auth/network-request-failed":
          description =
            "Chyba připojení k síti. Zkontrolujte internet a zkuste to znovu.";
          break;
      }

      toast({
        variant: "destructive",
        title: "Chyba přihlášení",
        description,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!normalizedEmail) {
      toast({
        variant: "destructive",
        title: "Zadejte email",
        description:
          "Nejdříve zadejte emailovou adresu, na kterou chcete poslat obnovu hesla.",
      });
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      toast({
        variant: "destructive",
        title: "Neplatný email",
        description: "Zadejte email ve správném formátu.",
      });
      return;
    }

    if (!auth || !areServicesAvailable) {
      toast({
        variant: "destructive",
        title: "Obnova hesla není připravená",
        description:
          "Firebase se ještě nenačetl. Obnovte stránku a zkuste to znovu za chvíli.",
      });
      return;
    }

    setResetLoading(true);

    try {
      await sendPasswordResetEmail(auth, normalizedEmail);

      toast({
        title: "Email odeslán",
        description:
          "Pokud účet existuje, poslali jsme na zadaný email odkaz pro obnovu hesla. Zkontrolujte i spam.",
      });
    } catch (error) {
      console.error("[LoginPage] password reset failed", error);

      const authError = error as AuthError;
      let description =
        "Obnovu hesla se nepodařilo odeslat. Zkuste to znovu.";

      switch (authError?.code) {
        case "auth/invalid-email":
          description = "Email nemá správný formát.";
          break;
        case "auth/missing-email":
          description = "Zadejte emailovou adresu.";
          break;
        case "auth/too-many-requests":
          description =
            "Příliš mnoho pokusů. Zkuste odeslání znovu za chvíli.";
          break;
        case "auth/network-request-failed":
          description =
            "Chyba připojení k síti. Zkontrolujte internet a zkuste to znovu.";
          break;
      }

      toast({
        variant: "destructive",
        title: "Obnova hesla selhala",
        description,
      });
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="relative hidden bg-black lg:block">
        <Image
          src="https://picsum.photos/seed/rajmondata-login/1200/1200"
          alt="Login pozadí"
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
        <Card className="w-full max-w-md border-border bg-surface shadow-2xl">
          <CardHeader className="space-y-4 text-center">
            <div className="mx-auto flex justify-center">
              <Logo context="page" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-3xl font-bold tracking-tight text-foreground">
                Vítejte zpět
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Zadejte své údaje pro přístup k portálu
              </CardDescription>
            </div>
          </CardHeader>

          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4">
              {!areServicesAvailable ? (
                <div className="rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm text-orange-600">
                  Přihlašování se ještě načítá. Pokud stav trvá déle, obnovte
                  stránku.
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="email">Emailová adresa</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="jmeno@firma.cz"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="border-border bg-background text-foreground"
                  autoComplete="email"
                  inputMode="email"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Heslo</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="border-border bg-background text-foreground"
                  autoComplete="current-password"
                  required
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={resetLoading}
                  className="text-sm text-primary hover:underline disabled:opacity-60"
                >
                  {resetLoading ? "Odesílám reset..." : "Zapomenuté heslo?"}
                </button>
              </div>

              <Button
                type="submit"
                className="h-11 w-full bg-primary text-lg font-semibold text-white hover:bg-primary/90"
                disabled={!canSubmit}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Přihlašování...
                  </>
                ) : (
                  "Přihlásit se"
                )}
              </Button>
            </CardContent>
          </form>

          <CardFooter className="flex flex-col gap-4">
            <div className="relative w-full">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">
                  Nová firma?
                </span>
              </div>
            </div>

            <Link href="/register" className="w-full">
              <Button
                variant="outline"
                className="h-11 w-full gap-2 border-primary text-primary transition-all hover:bg-primary hover:text-white"
              >
                <UserPlus className="h-4 w-4" /> Registrovat firmu
              </Button>
            </Link>

            <Link href="/admin/login" className="w-full">
              <Button
                variant="ghost"
                className="h-10 w-full gap-2 text-muted-foreground hover:text-foreground"
              >
                <ShieldCheck className="h-4 w-4" /> Globální administrace
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}