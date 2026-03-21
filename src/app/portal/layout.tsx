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
import { AlertCircle } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { releaseDocumentModalLocks } from "@/lib/release-modal-locks";

const REDIRECT_GRACE_MS = 2500;

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const router = useRouter();
  const pathname = usePathname();

  const seedStartedRef = useRef(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [seedError, setSeedError] = useState<Error | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authResolved, setAuthResolved] = useState(false);

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
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);

  const isPortalEmployeeOnly =
    profile?.role === "employee" &&
    !(Array.isArray(profile?.globalRoles) &&
      profile.globalRoles.includes("super_admin"));

  const isEmployeePortalPath = pathname.startsWith("/portal/employee");

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
    });
  }, [
    pathname,
    mobileMenuOpen,
    isProfileLoading,
    isUserLoading,
    isSeeding,
    isPortalEmployeeOnly,
    isEmployeePortalPath,
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

  /** Automatický seed profilu jen ve vývoji — v produkci vzniká firma výhradně přes registraci (žádné náhodné demo). */
  const enableDevProfileSeed =
    typeof process !== "undefined" && process.env.NODE_ENV === "development";

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

  if (isUserLoading || (!authResolved && !user)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div
          className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"
          aria-label="Načítání"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <div
          className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">
          Ověřujeme přihlášení…
        </p>
      </div>
    );
  }

  if (seedError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-xl">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Chyba při nastavení účtu</AlertTitle>
          <AlertDescription>
            {seedError.message}
            <span className="block mt-2 text-xs">
              Zkuste obnovit stránku nebo se odhlásit a znovu přihlásit.
            </span>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isProfileLoading || isSeeding || !profile) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <div
          className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">
          {isSeeding ? "Nastavujeme váš pracovní prostor…" : "Načítání…"}
        </p>
      </div>
    );
  }

  if (isPortalEmployeeOnly && !isEmployeePortalPath) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <div
          className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">
          Otevírám zaměstnanecký portál…
        </p>
      </div>
    );
  }

  const SidebarComponent = isPortalEmployeeOnly
    ? EmployeePortalSidebar
    : BizForgeSidebar;

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden print:hidden lg:block shrink-0">
        <SidebarComponent />
      </aside>

      {/* Sheet jen když je menu otevřené — jinak žádný portal/overlay v DOM (řeší „uvíznutý“ tmavý backdrop). */}
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
        className="flex-1 flex flex-col min-w-0 min-h-screen bg-slate-100 text-slate-900"
        data-portal-content
      >
        <TopHeader onOpenMobileMenu={() => setMobileMenuOpen(true)} />
        <main className="flex-1 p-4 print:p-2 sm:p-6 lg:p-8 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}