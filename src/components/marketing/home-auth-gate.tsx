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

  if (isUserLoading || user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return children;
}
