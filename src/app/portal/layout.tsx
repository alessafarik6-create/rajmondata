
"use client";

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { BizForgeSidebar } from '@/components/layout/bizforge-sidebar';
import { TopHeader } from '@/components/layout/top-header';
import { doc } from 'firebase/firestore';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const router = useRouter();

  // Načtení profilu uživatele pro ověření organizace a rolí
  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  if (isUserLoading || isProfileLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // Multi-tenant check: Pokud uživatel nemá přiřazenou organizaci a není super_admin,
  // můžeme ho přesměrovat na výběr organizace nebo onboarding (zde zjednodušeno)
  
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <BizForgeSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopHeader />
        <main className="flex-1 p-8 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
