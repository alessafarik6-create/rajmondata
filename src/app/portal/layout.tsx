"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { useUser, useCompany, useFirebase, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { BizForgeSidebar } from "@/components/layout/bizforge-sidebar";
import { CustomerPortalSidebar } from "@/components/layout/customer-portal-sidebar";
import { EmployeePortalSidebar } from "@/components/layout/employee-portal-sidebar";
import { TopHeader } from "@/components/layout/top-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { releaseDocumentModalLocks } from "@/lib/release-modal-locks";
import {
  canAccessCompanyModule,
  getCompanyLicenseModules,
  getEffectiveModulesMerged,
  isCompanyLicenseActive,
  isCompanyLicenseBlocking,
  shouldShowLicensePendingNotice,
} from "@/lib/platform-access";
import {
  userCanAccessProductionPortal,
  userCanAccessWarehousePortal,
} from "@/lib/warehouse-production-access";
import { ActivitySessionBridge } from "@/components/portal/activity-session-bridge";
import {
  PlatformModuleCatalogProvider,
  useMergedPlatformModuleCatalog,
} from "@/contexts/platform-module-catalog-context";
import { isBindableFirestoreInstance } from "@/lib/firestore-instance-guard";
import {
  computeVisibleEmployeePortalModules,
  getOrgEmployeePortalModuleFlags,
  parseEmployeePortalModules,
} from "@/lib/employee-portal-modules";
import { parseAssignedWorklogJobIds } from "@/lib/assigned-jobs";
import { PwaInstallBanner } from "@/components/pwa/pwa-install-banner";
import { ChatAssistant } from "@/components/portal/ChatAssistant";
import { OnboardingOverlay } from "@/components/portal/OnboardingOverlay";

const REDIRECT_GRACE_MS = 2500;
/** Až po inicializaci Firebase — aby „čekání na služby“ nespouštělo falešný timeout. */
const SHELL_LOADING_TIMEOUT_MS = 30000;

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlatformModuleCatalogProvider>
      <PortalLayoutContent>{children}</PortalLayoutContent>
    </PlatformModuleCatalogProvider>
  );
}

function PortalLayoutContent({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading, userError } = useUser();
  const { firestore, areServicesAvailable, firebaseConfigError, auth } = useFirebase();
  const router = useRouter();
  const pathname = usePathname();

  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const {
    userProfile: profile,
    profileLoading: isProfileLoading,
    profileError,
    companyId,
    company,
    isLoading: companyBootstrapLoading,
    companyDocMissing,
    companyError: companyHookError,
  } = useCompany();

  const platformCatalog = useMergedPlatformModuleCatalog();

  const profileEmployeeRef = useMemoFirebase(() => {
    if (
      !isBindableFirestoreInstance(areServicesAvailable, firestore) ||
      !companyId ||
      !profile?.employeeId ||
      profile?.role !== "employee"
    ) {
      return null;
    }
    return doc(
      firestore,
      "companies",
      companyId,
      "employees",
      String(profile.employeeId)
    );
  }, [areServicesAvailable, firestore, companyId, profile?.employeeId, profile?.role]);
  const { data: profileEmployeeRow } = useDoc<Record<string, unknown>>(profileEmployeeRef);

  const orgPortalModules = useMemo(
    () => getOrgEmployeePortalModuleFlags(company, platformCatalog),
    [company, platformCatalog]
  );

  const employeePortalModulesParsed = useMemo(
    () => parseEmployeePortalModules(profileEmployeeRow),
    [profileEmployeeRow]
  );

  const visibleEmployeeModules = useMemo(
    () =>
      computeVisibleEmployeePortalModules(
        orgPortalModules,
        employeePortalModulesParsed
      ),
    [orgPortalModules, employeePortalModulesParsed]
  );

  const isPortalEmployeeOnly =
    profile?.role === "employee" &&
    !(Array.isArray(profile?.globalRoles) &&
      profile.globalRoles.includes("super_admin"));

  const isPortalCustomerOnly = profile?.role === "customer";

  const isFirebaseSuperAdmin =
    Array.isArray(profile?.globalRoles) && profile.globalRoles.includes("super_admin");

  const tenantOrganizationIsDeleted =
    company &&
    (company.isDeleted === true ||
      String(company.tenantStatus ?? "").toLowerCase() === "deleted");

  /** Zákazník smí jen `/portal/customer/*` a sdílená oznámení — žádné firemní doklady, finance, interní zakázky. */
  const isCustomerAllowedBranchPath =
    pathname.startsWith("/portal/customer") ||
    pathname.startsWith("/portal/notifications");

  /** Zaměstnanec může mimo /portal/employee jen tyto větve (docházka, sklad, výroba). */
  const isEmployeeAllowedBranchPath =
    pathname.startsWith("/portal/employee") ||
    pathname.startsWith("/portal/labor") ||
    pathname.startsWith("/portal/sklad") ||
    pathname.startsWith("/portal/vyroba") ||
    pathname.startsWith("/portal/notifications") ||
    pathname.startsWith("/portal/help");

  /** Načítání profilu z Firestore — bez automatického doplňování dokumentu (žádný nový auth účet). */
  const waitingForProfileResolution = isProfileLoading;

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.log("[PortalLayout] modal / loading", {
      pathname,
      mobileMenuOpen,
      isProfileLoading,
      isUserLoading,
      isPortalEmployeeOnly,
      isEmployeeAllowedBranchPath,
      waitingForProfileResolution,
      hasProfile: !!profile,
      profileError: profileError?.message ?? null,
    });
  }, [
    pathname,
    mobileMenuOpen,
    isProfileLoading,
    isUserLoading,
    isPortalEmployeeOnly,
    isEmployeeAllowedBranchPath,
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
    if (isPortalEmployeeOnly && !isEmployeeAllowedBranchPath) {
      router.replace("/portal/employee");
    }
  }, [
    profile,
    isProfileLoading,
    isPortalEmployeeOnly,
    isEmployeeAllowedBranchPath,
    router,
  ]);

  useEffect(() => {
    if (!profile || isProfileLoading) return;
    if (profile.role !== "customer") return;
    if (pathname.startsWith("/portal/customer")) return;
    router.replace("/portal/customer");
  }, [profile, isProfileLoading, pathname, router]);

  /** Moduly sklad / výroba — licence + role / přiřazení zaměstnance; blokace přímého URL. */
  useEffect(() => {
    if (!profile || isProfileLoading || !company) return;
    const skladPath = pathname.startsWith("/portal/sklad");
    const vyrobaPath = pathname.startsWith("/portal/vyroba");
    if (!skladPath && !vyrobaPath) return;
    if (skladPath) {
      if (!canAccessCompanyModule(company, "sklad", platformCatalog)) {
        router.replace("/portal/dashboard");
        return;
      }
      if (
        !userCanAccessWarehousePortal({
          role: String(profile.role || "employee"),
          globalRoles: profile.globalRoles as string[] | undefined,
          employeeRow: profileEmployeeRow as { canAccessWarehouse?: boolean } | null,
        })
      ) {
        router.replace("/portal/dashboard");
        return;
      }
    }
    if (vyrobaPath) {
      if (!canAccessCompanyModule(company, "vyroba", platformCatalog)) {
        router.replace("/portal/dashboard");
        return;
      }
      if (
        !userCanAccessProductionPortal({
          role: String(profile.role || "employee"),
          globalRoles: profile.globalRoles as string[] | undefined,
          employeeRow: profileEmployeeRow as { canAccessProduction?: boolean } | null,
        })
      ) {
        router.replace("/portal/dashboard");
        return;
      }
    }
  }, [
    profile,
    isProfileLoading,
    company,
    pathname,
    router,
    profileEmployeeRow,
    platformCatalog,
  ]);

  /** Zaměstnanecké moduly (Peníze, Zprávy, Docházka, Zakázky) — skryté položky + blokace přímého URL. */
  useEffect(() => {
    if (!profile || isProfileLoading || !company) return;
    if (!isPortalEmployeeOnly) return;
    const v = visibleEmployeeModules;

    if (pathname.startsWith("/portal/employee/money") && !v.penize) {
      router.replace("/portal/employee");
      return;
    }
    if (pathname.startsWith("/portal/employee/messages") && !v.zpravy) {
      router.replace("/portal/employee");
      return;
    }
    if (pathname.startsWith("/portal/employee/jobs") && !v.zakazky) {
      router.replace("/portal/employee");
      return;
    }
    const needsDochazkaModule =
      pathname.startsWith("/portal/employee/daily-reports") ||
      pathname.startsWith("/portal/employee/worklogs") ||
      pathname.startsWith("/portal/employee/work-log") ||
      pathname.startsWith("/portal/employee/attendance") ||
      pathname.startsWith("/portal/labor");
    if (needsDochazkaModule && !v.dochazka) {
      router.replace("/portal/employee");
    }
  }, [
    profile,
    isProfileLoading,
    company,
    isPortalEmployeeOnly,
    pathname,
    router,
    visibleEmployeeModules,
  ]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (!isPortalEmployeeOnly || !company) return;
    console.log("orgModules", orgPortalModules);
    console.log("employeeModules", employeePortalModulesParsed);
    console.log("visibleEmployeeModules", visibleEmployeeModules);
    console.log(
      "assignedJobIds",
      parseAssignedWorklogJobIds(
        (profileEmployeeRow ?? undefined) as Parameters<
          typeof parseAssignedWorklogJobIds
        >[0]
      )
    );
  }, [
    isPortalEmployeeOnly,
    company,
    orgPortalModules,
    employeePortalModulesParsed,
    visibleEmployeeModules,
    profileEmployeeRow,
  ]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !company || !companyId) return;
    const effectiveModules = getEffectiveModulesMerged(company);
    console.log("company (merged):", company);
    console.log("organization.modules (top-level):", company.modules);
    console.log("license.modules (nested):", getCompanyLicenseModules(company));
    console.log("effectiveModules (license layer ∪ org, +aliasy):", effectiveModules);
    console.log("company.license:", company.license);
    console.log("company.license.status:", company.license?.status);
    console.log("[Portal license debug]", {
      companyId,
      role: profile?.role ?? null,
      isCompanyLicenseActive: isCompanyLicenseActive(company),
      isCompanyLicenseBlocking: isCompanyLicenseBlocking(company),
      shouldShowLicensePendingNotice: shouldShowLicensePendingNotice(company),
      canAccessCompanyModuleSklad: canAccessCompanyModule(company, "sklad", platformCatalog),
      canAccessCompanyModuleVyroba: canAccessCompanyModule(company, "vyroba", platformCatalog),
    });
  }, [company, companyId, platformCatalog, profile?.role]);

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

  /**
   * Timeout až po připravení Firebase klienta — jinak 8–30 s „mrtvý“ stav jen kvůli pomalé inicializaci.
   * Při chybě env (firebaseConfigError) timer stejně poběží, aby šlo uniknout z rozbitého stavu.
   */
  useEffect(() => {
    if (!firebaseConfigError && !areServicesAvailable) {
      setShellTimedOut(false);
      return;
    }
    const t = window.setTimeout(() => setShellTimedOut(true), SHELL_LOADING_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [areServicesAvailable, firebaseConfigError, pathname]);

  /** Po úspěšném načtení obalu resetovat příznak timeoutu (uživatel nemá „zaseknutý“ shell). */
  useEffect(() => {
    if (
      user &&
      profile &&
      companyId &&
      !isUserLoading &&
      !isProfileLoading &&
      !companyBootstrapLoading &&
      !waitingForProfileResolution
    ) {
      setShellTimedOut(false);
    }
  }, [
    user,
    profile,
    companyId,
    isUserLoading,
    isProfileLoading,
    companyBootstrapLoading,
    waitingForProfileResolution,
  ]);

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[PortalLayout] Auto auth creation disabled — ensureUserFirestoreDocument removed from portal layout"
      );
    }
  }, []);

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
    return spinner("Načítání profilu…");
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

  if (!companyId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-xl border-destructive/60">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Uživatel nemá přiřazenou firmu</AlertTitle>
          <AlertDescription>
            V profilu chybí platné <code className="text-xs">companyId</code>. Kontaktujte administrátora nebo se
            odhlaste a přihlaste znovu.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (companyBootstrapLoading) {
    if (shellTimedOut) {
      return shellTimeoutUi;
    }
    return spinner("Načítání firmy…");
  }

  if (companyDocMissing) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-xl border-destructive/60">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Firma neexistuje</AlertTitle>
          <AlertDescription>
            V databázi chybí dokument firmy pro{" "}
            <code className="text-xs rounded bg-background/80 px-1 py-0.5">
              companies/{companyId}
            </code>
            . Účet odkazuje na neexistující organizaci. Kontaktujte administrátora nebo podporu.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (tenantOrganizationIsDeleted && !isFirebaseSuperAdmin) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-4">
        <Alert className="max-w-xl border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10">
          <AlertCircle className="h-4 w-4 text-amber-700 dark:text-amber-400" />
          <AlertTitle>Organizace není dostupná</AlertTitle>
          <AlertDescription className="text-amber-950/90 dark:text-amber-50/90">
            Organizace je smazaná a čeká na trvalé odstranění. Kontaktujte podporu.
          </AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => void signOut(auth)}
        >
          Odhlásit se
        </Button>
      </div>
    );
  }

  if (companyHookError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-xl border-destructive/60">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Firmu nelze načíst</AlertTitle>
          <AlertDescription>
            {companyHookError.message}
            <span className="block mt-2 text-xs opacity-90">
              Zkontrolujte pravidla Firestore a oprávnění účtu.
            </span>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isPortalEmployeeOnly && !isEmployeeAllowedBranchPath) {
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

  if (isPortalCustomerOnly && !isCustomerAllowedBranchPath) {
    if (shellTimedOut) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
          <p className="text-sm text-muted-foreground text-center">
            Tato část portálu není pro zákazníky dostupná.
          </p>
          <Button type="button" onClick={() => router.replace("/portal/customer")}>
            Otevřít klientský portál
          </Button>
        </div>
      );
    }
    return spinner("Otevírám klientský portál…");
  }

  const renderSidebar = (mobileClose?: () => void) =>
    isPortalEmployeeOnly ? (
      <EmployeePortalSidebar
        visibleEmployeeModules={visibleEmployeeModules}
        mobileSheetClose={mobileClose}
      />
    ) : isPortalCustomerOnly ? (
      <CustomerPortalSidebar mobileSheetClose={mobileClose} />
    ) : (
      <BizForgeSidebar mobileSheetClose={mobileClose} />
    );

  const licenseNotice = (() => {
    if (isPortalEmployeeOnly || isPortalCustomerOnly || !company) return null;
    if (isCompanyLicenseActive(company)) return null;

    if (shouldShowLicensePendingNotice(company)) {
      return (
        <Alert className="mb-4 border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-50">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Licence čeká na schválení</AlertTitle>
          <AlertDescription>
            Účet firmy zatím nebyl aktivován superadministrátorem. Placené moduly jsou vypnuté, dokud neproběhne
            aktivace licence.
          </AlertDescription>
        </Alert>
      );
    }
    if (isCompanyLicenseBlocking(company)) {
      return (
        <Alert variant="destructive" className="mb-4 border-destructive/50">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Licence není aktivní</AlertTitle>
          <AlertDescription>
            Přístup k placeným modulům je omezený. Pro aktivaci nebo prodloužení kontaktujte podporu nebo
            administrátora platformy.
          </AlertDescription>
        </Alert>
      );
    }
    return null;
  })();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {user && companyId ? <ActivitySessionBridge /> : null}
      <aside className="hidden print:hidden lg:block shrink-0">
        {renderSidebar()}
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
              {renderSidebar(() => {
                setMobileMenuOpen(false);
                releaseDocumentModalLocks();
              })}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      <div
        className="flex-1 flex flex-col min-w-0 min-h-screen bg-slate-100 text-slate-900 dark:bg-background dark:text-foreground"
        data-portal-content
      >
        <PwaInstallBanner />
        <TopHeader onOpenMobileMenu={() => setMobileMenuOpen(true)} />
        <main className="flex-1 overflow-x-hidden overflow-y-auto px-3 py-3 print:p-2 sm:px-4 sm:py-4 md:px-6 md:py-6 lg:px-8 lg:py-8 min-w-0">
          {licenseNotice}
          {children}
        </main>
      </div>
      <ChatAssistant />
      <OnboardingOverlay enabled={!isPortalEmployeeOnly && !isPortalCustomerOnly} />
    </div>
  );
}
