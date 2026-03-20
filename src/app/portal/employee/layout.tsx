"use client";

import React, { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { Loader2 } from "lucide-react";
import { releaseDocumentModalLocks } from "@/lib/release-modal-locks";

const DEBUG_EMPLOYEE_LAYOUT = process.env.NODE_ENV === "development";

/**
 * Sekce jen pro uživatele s rolí employee (bez super_admin přepínače).
 * Ostatní role přesměrujeme na standardní portál.
 */
export default function EmployeeSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const router = useRouter();
  const pathname = usePathname();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);

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
      });
    }
  }, [
    pathname,
    user?.uid,
    profile,
    isUserLoading,
    isProfileLoading,
    isEmployeePortalUser,
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

  if (isUserLoading || !user) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-slate-600">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <p className="text-sm">Načítání účtu…</p>
      </div>
    );
  }

  if (isProfileLoading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-slate-600">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <p className="text-sm">Načítání profilu…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-950 max-w-lg">
        <p className="font-medium">Uživatelský profil nebyl nalezen</p>
        <p className="text-sm mt-2 text-amber-900/90">
          V databázi chybí dokument{" "}
          <code className="text-xs bg-white/80 px-1 rounded">users/{user.uid}</code>.
          Odhlaste se a přihlaste znovu, případně kontaktujte administrátora.
        </p>
      </div>
    );
  }

  if (!isEmployeePortalUser) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm gap-2">
        <Loader2 className="h-5 w-5 animate-spin shrink-0" aria-hidden />
        <span>Přesměrování na portál…</span>
      </div>
    );
  }

  return <>{children}</>;
}
