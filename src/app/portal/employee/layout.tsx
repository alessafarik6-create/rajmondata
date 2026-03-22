"use client";

import React, { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { releaseDocumentModalLocks } from "@/lib/release-modal-locks";

const DEBUG_EMPLOYEE_LAYOUT = process.env.NODE_ENV === "development";
const LAYOUT_TIMEOUT_MS = 8000;

/**
 * Sekce jen pro uživatele s rolí employee (bez super_admin přepínače).
 * Ostatní role přesměrujeme na standardní portál.
 */
export default function EmployeeSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isUserLoading, userError } = useUser();
  const firestore = useFirestore();
  const router = useRouter();
  const pathname = usePathname();
  const [shellTimedOut, setShellTimedOut] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setShellTimedOut(true), LAYOUT_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, []);

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const {
    data: profile,
    isLoading: isProfileLoading,
    error: profileError,
  } = useDoc(userRef);

  const isEmployeePortalUser =
    profile?.role === "employee" &&
    !(
      Array.isArray(profile?.globalRoles) &&
      profile.globalRoles.includes("super_admin")
    );

  useEffect(() => {
    releaseDocumentModalLocks();
    const id = window.requestAnimationFrame(() => releaseDocumentModalLocks());
    return () => window.cancelAnimationFrame(id);
  }, [pathname]);

  useEffect(() => {
    if (DEBUG_EMPLOYEE_LAYOUT && typeof window !== "undefined") {
      console.log("[employee/layout]", {
        route: pathname,
        uid: user?.uid ?? null,
        role: profile?.role ?? null,
        companyId: profile?.companyId ?? null,
        employeeId: profile?.employeeId ?? null,
        isUserLoading,
        isProfileLoading,
        hasProfile: !!profile,
        isEmployeePortalUser,
        profileError: profileError?.message ?? null,
      });
    }
  }, [
    pathname,
    user?.uid,
    profile,
    isUserLoading,
    isProfileLoading,
    isEmployeePortalUser,
    profileError,
  ]);

  useEffect(() => {
    if (isUserLoading || isProfileLoading) return;
    if (!user) return;
    if (!profile) return;
    if (!isEmployeePortalUser) {
      router.replace("/portal/dashboard");
    }
  }, [
    user,
    profile,
    isUserLoading,
    isProfileLoading,
    isEmployeePortalUser,
    router,
  ]);

  const timeoutFallback = (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-4 max-w-lg mx-auto">
      <Alert variant="destructive" className="w-full border-destructive/60">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Načítání trvá příliš dlouho</AlertTitle>
        <AlertDescription>Zkuste obnovit stránku nebo se znovu přihlásit.</AlertDescription>
      </Alert>
      <div className="flex flex-col sm:flex-row gap-2 w-full">
        <Button type="button" className="flex-1" onClick={() => window.location.reload()}>
          Obnovit
        </Button>
        <Button type="button" variant="outline" className="flex-1" onClick={() => router.push("/login")}>
          Přihlásit se
        </Button>
      </div>
    </div>
  );

  if (userError) {
    return (
      <Alert variant="destructive" className="max-w-lg border-destructive/60">
        <AlertTitle>Chyba ověření</AlertTitle>
        <AlertDescription>{userError.message}</AlertDescription>
      </Alert>
    );
  }

  if (isUserLoading) {
    if (shellTimedOut) return timeoutFallback;
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <p className="text-sm">Ověřování přihlášení…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground max-w-md mx-auto px-4">
        <p className="text-sm text-center">Pro tuto sekci musíte být přihlášeni.</p>
        <Button type="button" onClick={() => router.replace("/login")}>
          Přihlásit se
        </Button>
      </div>
    );
  }

  if (profileError) {
    return (
      <Alert variant="destructive" className="max-w-lg border-destructive/60">
        <AlertTitle>Profil se nepodařilo načíst</AlertTitle>
        <AlertDescription>{profileError.message}</AlertDescription>
      </Alert>
    );
  }

  if (isProfileLoading) {
    if (shellTimedOut) return timeoutFallback;
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <p className="text-sm">Načítání profilu…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 dark:bg-amber-500/10 dark:border-amber-500/40 p-6 text-amber-950 dark:text-amber-50 max-w-lg">
        <p className="font-medium">Uživatelský profil nebyl nalezen</p>
        <p className="text-sm mt-2 opacity-90">
          V databázi chybí dokument{" "}
          <code className="text-xs bg-background/80 dark:bg-background/30 px-1 rounded">
            users/{user.uid}
          </code>
          . Odhlaste se a přihlaste znovu, případně kontaktujte administrátora.
        </p>
      </div>
    );
  }

  if (!isEmployeePortalUser) {
    if (shellTimedOut) {
      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4">
          <p className="text-sm text-muted-foreground text-center">Přesměrování se nepodařilo.</p>
          <Button type="button" onClick={() => router.replace("/portal/dashboard")}>
            Otevřít přehled
          </Button>
        </div>
      );
    }
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm gap-2">
        <Loader2 className="h-5 w-5 animate-spin shrink-0" aria-hidden />
        <span>Přesměrování na portál…</span>
      </div>
    );
  }

  return <>{children}</>;
}
