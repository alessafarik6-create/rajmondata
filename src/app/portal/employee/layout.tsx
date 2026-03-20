"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";

/**
 * Sekce jen pro uživatele s rolí employee (bez super_admin přepínače).
 * Ostatní role přesměrujeme na standardní portál.
 */
export default function EmployeeSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useUser();
  const firestore = useFirestore();
  const router = useRouter();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading } = useDoc(userRef);

  const isEmployeePortalUser =
    profile?.role === "employee" &&
    !(Array.isArray(profile?.globalRoles) &&
      profile.globalRoles.includes("super_admin"));

  useEffect(() => {
    if (!user || isLoading || !profile) return;
    if (!isEmployeePortalUser) {
      router.replace("/portal/dashboard");
    }
  }, [user, profile, isLoading, isEmployeePortalUser, router]);

  if (!user || isLoading || !profile) {
    return null;
  }

  if (!isEmployeePortalUser) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
        Přesměrování…
      </div>
    );
  }

  return <>{children}</>;
}
