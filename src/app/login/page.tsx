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
import Link from "next/link";
import { PublicAuthMediaPanel } from "@/components/marketing/public-auth-media-panel";
import { usePublicLandingConfig } from "@/lib/use-public-landing-config";
import type { PlatformSeoHeroImage, PlatformSeoPromoVideo } from "@/lib/platform-seo-sanitize";
import {
  AuthError,
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { useToast } from "@/hooks/use-toast";
import { doc, getDoc } from "firebase/firestore";
import { describeFirebaseAuthError } from "@/lib/firebase-client-env";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function LoginPage() {
  const { auth, firestore, areServicesAvailable, firebaseConfigError } = useFirebase();
  const { toast } = useToast();
  const { data: landingCfg } = usePublicLandingConfig();
  const seo = landingCfg?.seo;

  const loginImages = useMemo((): PlatformSeoHeroImage[] => {
    const raw = seo?.loginImages;
    if (!Array.isArray(raw)) return [];
    return raw.filter((x) => x && typeof (x as PlatformSeoHeroImage).url === "string") as PlatformSeoHeroImage[];
  }, [seo?.loginImages]);

  const loginVideo = (seo?.loginVideo as PlatformSeoPromoVideo | null) ?? null;

  const mediaTitle =
    (typeof seo?.loginPageTitle === "string" && seo.loginPageTitle.trim()) || PLATFORM_NAME;
  const mediaSubtitle =
    "Cloudová platforma pro týmy, zakázky a finance. Bezpečné přihlášení k portálu.";

  const cardWelcome =
    (typeof seo?.loginWelcomeText === "string" && seo.loginWelcomeText.trim()) || "Vítejte zpět";
  const cardDesc =
    (typeof seo?.loginPageSubtitle === "string" && seo.loginPageSubtitle.trim()) ||
    "Zadejte své údaje pro přístup k portálu";
  const labelEmail = (typeof seo?.loginEmailLabel === "string" && seo.loginEmailLabel.trim()) || "Emailová adresa";
  const labelPassword = (typeof seo?.loginPasswordLabel === "string" && seo.loginPasswordLabel.trim()) || "Heslo";
  const regButtonLabel =
    (typeof seo?.registerButtonText === "string" && seo.registerButtonText.trim()) || "Registrovat firmu";

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

    if (firebaseConfigError) {
      toast({
        variant: "destructive",
        title: "Chybí konfigurace Firebase",
        description: firebaseConfigError,
      });
      return;
    }

    if (!auth || !firestore || !areServicesAvailable) {
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

      const cred = await signInWithEmailAndPassword(
        auth,
        normalizedEmail,
        password
      );

      if (process.env.NODE_ENV === "development") {
        console.log("[LoginPage] Auto profile seed disabled — no ensureUserFirestoreDocument after login");
      }

      toast({
        title: "Přihlášení úspěšné",
        description: `Vítejte zpět v ${PLATFORM_NAME}.`,
      });

      let target = "/portal/dashboard";
      try {
        const snap = await getDoc(doc(firestore, "users", cred.user.uid));
        if (snap.exists()) {
          const d = snap.data();
          const globalRoles = Array.isArray(d.globalRoles)
            ? d.globalRoles
            : [];
          if (
            d.role === "employee" &&
            !globalRoles.includes("super_admin")
          ) {
            target = "/portal/employee";
          }
        }
      } catch (profileErr) {
        console.warn("[LoginPage] profile redirect check failed", profileErr);
      }

      window.location.assign(target);
      return;
    } catch (error) {
      console.error("[LoginPage] login failed", error);

      const authError = error as AuthError;
      const description = describeFirebaseAuthError(authError?.code);

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

    setResetLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };

      if (res.status === 400) {
        toast({
          variant: "destructive",
          title: "Obnova hesla",
          description: json.error || "Zkuste to znovu.",
        });
        return;
      }

      if (res.ok && json.success === true) {
        toast({
          title: "Hotovo",
          description: "Pokud účet existuje, poslali jsme email.",
        });
        return;
      }

      console.warn("[passwordReset] server error or no success", res.status, json);
      toast({
        variant: "destructive",
        title: "Obnova hesla",
        description: "Reset hesla se nepodařilo odeslat.",
      });
    } catch (e) {
      console.error("[passwordReset] fetch failed", e);
      toast({
        variant: "destructive",
        title: "Obnova hesla",
        description: "Reset hesla se nepodařilo odeslat.",
      });
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="flex min-h-screen flex-col lg:grid lg:grid-cols-2">
        <div className="order-2 min-h-0 w-full min-w-0 shrink-0 lg:order-1">
          <PublicAuthMediaPanel
            images={loginImages}
            video={loginVideo}
            title={mediaTitle}
            subtitle={mediaSubtitle}
          />
        </div>

        <div className="order-1 flex w-full min-w-0 items-center justify-center px-3 py-6 sm:px-5 sm:py-8 lg:order-2 lg:px-8">
        <Card className="w-full max-w-md border-slate-200 bg-white text-slate-900 shadow-xl">
          <CardHeader className="space-y-3 text-center sm:space-y-4">
            <div className="mx-auto flex justify-center">
              <Logo context="page" compact />
            </div>
            <div className="space-y-1.5 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Přihlášení</p>
              <CardTitle className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {cardWelcome}
              </CardTitle>
              <CardDescription className="text-slate-600 text-sm sm:text-base">
                {cardDesc}
              </CardDescription>
            </div>
          </CardHeader>

          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4 px-4 sm:px-6">
              {firebaseConfigError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {firebaseConfigError}
                </div>
              ) : !areServicesAvailable ? (
                <div className="rounded-md border border-orange-500/30 bg-orange-100 px-3 py-2 text-sm text-orange-800">
                  Přihlašování se ještě načítá. Pokud stav trvá déle, obnovte
                  stránku.
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-800 font-medium">
                  {labelEmail}
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="jmeno@firma.cz"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="min-h-11 border-slate-300 bg-white text-slate-900 placeholder:text-slate-500"
                  autoComplete="email"
                  inputMode="email"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-800 font-medium">
                  {labelPassword}
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="min-h-11 border-slate-300 bg-white text-slate-900 placeholder:text-slate-400"
                  autoComplete="current-password"
                  required
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={resetLoading}
                  className="text-sm text-orange-600 hover:underline disabled:opacity-60"
                >
                  {resetLoading ? "Odesílám reset..." : "Zapomenuté heslo?"}
                </button>
              </div>

              <Button
                type="submit"
                className="h-11 w-full text-base font-semibold"
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

          <CardFooter className="flex flex-col gap-3 px-4 pb-6 sm:px-6 sm:pb-8">
            <div className="relative w-full">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-slate-500">Nová firma?</span>
              </div>
            </div>

            <Link href="/register" className="w-full">
              <Button
                variant="outline"
                className="h-11 w-full gap-2 border-slate-300 text-slate-900 hover:bg-slate-50"
              >
                <UserPlus className="h-4 w-4" /> {regButtonLabel}
              </Button>
            </Link>

            <Link href="/admin/login" className="w-full">
              <Button variant="ghost" className="h-10 w-full gap-2 text-slate-600 hover:text-slate-900">
                <ShieldCheck className="h-4 w-4" /> Globální administrace
              </Button>
            </Link>
          </CardFooter>
        </Card>
        </div>
      </div>
    </div>
  );
}