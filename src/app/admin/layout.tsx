
"use client";

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useUser } from '@/firebase';
import { BizForgeSidebar } from '@/components/layout/bizforge-sidebar';
import { TopHeader } from '@/components/layout/top-header';
import { getIdTokenResult } from 'firebase/auth';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    if (pathname === '/admin/login') {
      setIsAuthorized(true);
      return;
    }

    const verifyAdminAccess = async () => {
      if (!isUserLoading) {
        if (!user) {
          router.push('/admin/login');
          setIsAuthorized(false);
          return;
        }

        try {
          const tokenResult = await getIdTokenResult(user);
          const hasSuperAdminClaim = tokenResult.claims.systemRole === 'super_admin';
          
          // Pro prototyp povolujeme také specifický demo email
          const isDemoAdmin = user.email === 'admin@bizforge.cz';

          if (hasSuperAdminClaim || isDemoAdmin) {
            setIsAuthorized(true);
          } else {
            console.warn("Uživatel nemá oprávnění pro super_admin roli.");
            router.push('/admin/login');
            setIsAuthorized(false);
          }
        } catch (error) {
          console.error("Chyba při ověřování práv:", error);
          router.push('/admin/login');
          setIsAuthorized(false);
        }
      }
    };

    verifyAdminAccess();
  }, [user, isUserLoading, pathname, router]);

  if (isUserLoading || isAuthorized === null) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <div className="space-y-1">
            <p className="text-white font-medium">Zabezpečený přístup</p>
            <p className="text-zinc-500 text-xs uppercase tracking-widest animate-pulse font-mono">Ověřování oprávnění</p>
          </div>
        </div>
      </div>
    );
  }

  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

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
