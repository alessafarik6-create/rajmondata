"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import { BizForgeSidebar } from "@/components/layout/bizforge-sidebar";
import { EmployeePortalSidebar } from "@/components/layout/employee-portal-sidebar";
import { TopHeader } from "@/components/layout/top-header";
import { doc } from "firebase/firestore";
import { ensureUserProfile } from "@/lib/seed-firestore";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { releaseDocumentModalLocks } from "@/lib/release-modal-locks";

const REDIRECT_GRACE_MS = 2500;
const SHELL_LOADING_TIMEOUT_MS = 8000;

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isUserLoading, userError } = useUser();
  const firestore = useFirestore();
  const router = useRouter();
  const pathname = usePathname();

  const seedStartedRef = useRef(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [seedError, setSeedError] = useState<Error | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authResolved, setAuthResolved] = useState(false);
  const [shellTimedOut, setShellTimedOut] = useState(false);

  /** Po změně route zavřít mobilní menu a uvolnit případné zámky od Radix modalu. */
  useEffect(() => {
    setMobileMenuOpen(false);
    releaseDocumentModalLocks();
    const id = window.requestAnimationFrame(() => releaseDocumentModalLocks());
    return () => window.cancelAnimationFrame(id);
  }, [pathname]);

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const {
    data: profile,
    isLoading: isProfileLoading,
    error: profileError,
  } = useDoc(userRef);

  const isPortalEmployeeOnly =
    profile?.role === "employee" &&
    !(Array.isArray(profile?.globalRoles) &&
      profile.globalRoles.includes("super_admin"));

  const isEmployeePortalPath = pathname.startsWith("/portal/employee");

  /** Automatický seed profilu jen ve vývoji — v produkci vzniká firma výhradně přes registraci (žádné náhodné demo). */
  const enableDevProfileSeed =
    typeof process !== "undefined" && process.env.NODE_ENV === "development";

  /**
   * Čekání na profil: načítání, seed, nebo (dev) krátké okno před spuštěním seedu.
   * Nikdy jen „!profile“ bez toho — v produkci by to bylo nekonečné, když dokument users/{uid} neexistuje.
   */
  const waitingForProfileResolution =
    isProfileLoading ||
    isSeeding ||
    (Boolean(user) &&
      profile == null &&
      enableDevProfileSeed &&
      !seedError);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.log("[PortalLayout] modal / loading", {
      pathname,
      mobileMenuOpen,
      isProfileLoading,
      isUserLoading,
      isSeeding,
      isPortalEmployeeOnly,
      isEmployeePortalPath,
      waitingForProfileResolution,
      hasProfile: !!profile,
      profileError: profileError?.message ?? null,
    });
  }, [
    pathname,
    mobileMenuOpen,
    isProfileLoading,
    isUserLoading,
    isSeeding,
    isPortalEmployeeOnly,
    isEmployeePortalPath,
    waitingForProfileResolution,
    profile,
    profileError,
  ]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      releaseDocumentModalLocks();
    }
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!profile || isProfileLoading) return;
    if (isPortalEmployeeOnly && !isEmployeePortalPath) {
      router.replace("/portal/employee");
    }
  }, [
    profile,
    isProfileLoading,
    isPortalEmployeeOnly,
    isEmployeePortalPath,
    router,
  ]);

  useEffect(() => {
    if (isUserLoading) {
      setAuthResolved(false);
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
      return;
    }

    if (user) {
      setAuthResolved(true);
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
      return;
    }

    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current);
    }

    redirectTimerRef.current = setTimeout(() => {
      setAuthResolved(true);
      router.replace("/login");
    }, REDIRECT_GRACE_MS);

    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };
  }, [user, isUserLoading, router]);

  /** Globální timeout obalu portálu — žádný nekonečný spinner. */
  useEffect(() => {
    const t = window.setTimeout(() => setShellTimedOut(true), SHELL_LOADING_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, []);

  /** Automatický seed profilu jen ve vývoji */
  useEffect(() => {
    if (
      !enableDevProfileSeed ||
      !user ||
      !firestore ||
      isProfileLoading ||
      profile != null ||
      seedStartedRef.current
    ) {
      return;
    }

    seedStartedRef.current = true;
    setIsSeeding(true);
    setSeedError(null);

    ensureUserProfile(user, firestore)
      .then(() => {
        if (typeof window !== "undefined") {
          console.debug(
            "[PortalLayout] Dev seed completed, profile will update via useDoc"
          );
        }
      })
      .catch((err) => {
        console.error("[PortalLayout] Dev seed failed", err);
        setSeedError(err instanceof Error ? err : new Error("Seed failed"));
        seedStartedRef.current = false;
      })
      .finally(() => {
        setIsSeeding(false);
      });
  }, [
    enableDevProfileSeed,
    user,
    firestore,
    isProfileLoading,
    profile,
  ]);

  const shellTimeoutUi = (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4 py-8">
      <Alert variant="destructive" className="max-w-lg w-full border-destructive/60">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Načítání trvá příliš dlouho</AlertTitle>
        <AlertDescription>
          Zkuste obnovit stránku nebo se znovu přihlásit. Pokud problém přetrvává, zkontrolujte připojení
          a oprávnění účtu ve Firestore.
        </AlertDescription>
      </Alert>
      <div className="flex flex-col sm:flex-row gap-2 w-full max-w-lg">
        <Button type="button" className="min-h-11 flex-1" onClick={() => window.location.reload()}>
          Obnovit stránku
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 flex-1 border-border"
          onClick={() => router.replace("/login")}
        >
          Přihlásit se
        </Button>
      </div>
    </div>
  );

  const spinner = (label: string) => (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
      <div
        className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"
        aria-label={label}
      />
      <p className="text-sm text-muted-foreground text-center max-w-sm">{label}</p>
    </div>
  );

  if (userError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-xl border-destructive/60">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Chyba ověření účtu</AlertTitle>
          <AlertDescription>{userError.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isUserLoading || (!authResolved && !user)) {
    if (shellTimedOut) {
      return shellTimeoutUi;
    }
    return spinner("Ověřování přihlášení…");
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-sm text-muted-foreground text-center">
          Nejste přihlášeni. Přesměrování na přihlášení…
        </p>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => router.replace("/login")}>
          Přihlásit se
        </Button>
      </div>
    );
  }

  if (seedError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-xl border-destructive/60">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Chyba při nastavení účtu</AlertTitle>
          <AlertDescription>
            {seedError.message}
            <span className="block mt-2 text-xs opacity-90">
              Zkuste obnovit stránku nebo se odhlásit a znovu přihlásit.
            </span>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-xl border-destructive/60">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Profil se nepodařilo načíst</AlertTitle>
          <AlertDescription>
            Firestore odmítl přístup k dokumentu uživatele nebo došlo k chybě:{" "}
            {profileError.message}
            <span className="block mt-2 text-xs opacity-90">
              Zkontrolujte pravidla Firestore a přihlášení.
            </span>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (waitingForProfileResolution) {
    if (shellTimedOut) {
      return shellTimeoutUi;
    }
    return spinner(
      isSeeding ? "Nastavujeme váš pracovní prostor…" : "Načítání profilu…"
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Alert className="max-w-xl border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10">
          <AlertCircle className="h-4 w-4 text-amber-700 dark:text-amber-400" />
          <AlertTitle>Uživatelský profil neexistuje</AlertTitle>
          <AlertDescription className="text-amber-950/90 dark:text-amber-50/90">
            V databázi chybí dokument{" "}
            <code className="text-xs rounded bg-background/80 dark:bg-background/30 px-1 py-0.5">
              users/{user.uid}
            </code>
            . Účet je v přihlášení, ale záznam ve Firestore nebyl vytvořen (např. nedokončená registrace).
            <span className="block mt-3 text-sm">
              Odhlaste se a přihlaste znovu, nebo kontaktujte administrátora.
            </span>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isPortalEmployeeOnly && !isEmployeePortalPath) {
    if (shellTimedOut) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
          <p className="text-sm text-muted-foreground text-center">
            Přesměrování na zaměstnanecký portál se nepodařilo dokončit.
          </p>
          <Button type="button" onClick={() => router.replace("/portal/employee")}>
            Otevřít zaměstnanecký portál
          </Button>
        </div>
      );
    }
    return spinner("Otevírám zaměstnanecký portál…");
  }

  const SidebarComponent = isPortalEmployeeOnly
    ? EmployeePortalSidebar
    : BizForgeSidebar;

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden print:hidden lg:block shrink-0">
        <SidebarComponent />
      </aside>

      {mobileMenuOpen ? (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) {
              setMobileMenuOpen(false);
              releaseDocumentModalLocks();
            }
          }}
          modal
        >
          <SheetContent
            side="left"
            className="w-[min(280px,85vw)] max-w-full p-0 bg-sidebar border-sidebar-border rounded-r-lg [&>button]:text-sidebar-foreground [&>button]:hover:bg-sidebar-accent [&>button]:hover:text-sidebar-primary"
          >
            <div className="flex flex-col h-full overflow-y-auto">
              <SidebarComponent
                mobileSheetClose={() => {
                  setMobileMenuOpen(false);
                  releaseDocumentModalLocks();
                }}
              />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      <div
        className="flex-1 flex flex-col min-w-0 min-h-screen bg-slate-100 text-slate-900 dark:bg-background dark:text-foreground"
        data-portal-content
      >
        <TopHeader onOpenMobileMenu={() => setMobileMenuOpen(true)} />
        <main className="flex-1 overflow-auto px-4 py-4 print:p-2 md:px-6 md:py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
