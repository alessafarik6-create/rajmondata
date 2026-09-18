"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/firebase";

type Props = { children: React.ReactNode };

/** Přihlášeného uživatele pošle do portálu; jinak zobrazí veřejnou homepage (server children). */
export default function HomeAuthGate({ children }: Props) {
  const { user, isUserLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!isUserLoading && user) {
      router.replace("/portal/dashboard");
    }
  }, [user, isUserLoading, router]);

  // Veřejný obsah vždy v HTML (SSR pro Googlebot). Přihlášení přesměrujeme až na klientovi.
  return children;
}
