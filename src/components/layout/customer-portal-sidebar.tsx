"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Briefcase, User, ShieldCheck, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import { useUser, useDoc, useFirestore, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { CUSTOMER_PORTAL_MENU_ITEMS } from "@/lib/customer-portal-menu";

const ICONS: Record<string, typeof LayoutDashboard> = {
  "customer-home": LayoutDashboard,
  "customer-jobs": Briefcase,
  "customer-catalogs": Package,
  "customer-profile": User,
};

type CustomerPortalSidebarProps = {
  mobileSheetClose?: () => void;
};

export function CustomerPortalSidebar({ mobileSheetClose }: CustomerPortalSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useUser();
  const firestore = useFirestore();
  const userRef = useMemoFirebase(
    () => (user ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: userProfile } = useDoc(userRef);
  const isSuperAdmin = userProfile?.globalRoles?.includes("super_admin");

  const visibleItems = useMemo(() => {
    const items = [...CUSTOMER_PORTAL_MENU_ITEMS];
    if (process.env.NODE_ENV === "development") {
      console.log("customer menu items", items.map((i) => i.id));
    }
    return items;
  }, []);

  const isCustomerNavActive = (id: string, href: string) => {
    if (id === "customer-home") {
      return pathname === "/portal/customer" || pathname === "/portal/customer/";
    }
    if (id === "customer-jobs") {
      return pathname.startsWith("/portal/customer/jobs");
    }
    if (id === "customer-profile") {
      return pathname.startsWith("/portal/customer/profile");
    }
    if (id === "customer-catalogs") {
      return pathname.startsWith("/portal/customer/catalogs");
    }
    return pathname === href;
  };

  const linkClass = (id: string, href: string) =>
    cn(
      "flex w-full min-w-0 items-center gap-3 px-3 py-3 sm:py-2.5 rounded-lg transition-colors min-h-[44px] sm:min-h-0 touch-manipulation",
      isCustomerNavActive(id, href)
        ? "bg-sidebar-accent text-sidebar-primary font-medium"
        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary"
    );

  const handleMobileNav = (href: string) => {
    mobileSheetClose?.();
    window.setTimeout(() => router.push(href), 0);
  };

  return (
    <div className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col h-full sticky top-0 shrink-0">
      <div className="p-4 sm:p-6">
        <Link
          href="/portal/customer"
          className="block outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring rounded-lg"
        >
          <Logo context="sidebar" className="max-w-full" />
        </Link>
      </div>

      <nav className="flex-1 px-3 sm:px-4 space-y-0.5 overflow-y-auto min-h-0">
        <div className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wider mb-3 px-3 pt-2">
          Klientský portál
        </div>
        {visibleItems.map((item) => {
          const Icon = ICONS[item.id] ?? LayoutDashboard;
          return mobileSheetClose ? (
            <button
              key={item.href}
              type="button"
              className={cn(
                linkClass(item.id, item.href),
                "w-full border-0 bg-transparent text-left font-[inherit]"
              )}
              onClick={() => handleMobileNav(item.href)}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
            </button>
          ) : (
            <Link key={item.href} href={item.href} className={linkClass(item.id, item.href)}>
              <Icon className="w-5 h-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3 sm:p-4 mt-auto border-t border-sidebar-border shrink-0">
        <div className="px-3 py-2 mb-2">
          <p className="text-[10px] text-sidebar-foreground/70 uppercase font-bold">Role</p>
          <p className="text-xs font-semibold text-primary truncate">Zákazník</p>
        </div>
        {isSuperAdmin ? (
          mobileSheetClose ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left text-sm text-sidebar-foreground hover:text-primary transition-colors px-3 py-3 sm:py-2 border border-sidebar-border rounded-lg bg-sidebar-accent/50 min-h-[44px] sm:min-h-0 touch-manipulation"
              onClick={() => handleMobileNav("/admin/dashboard")}
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span className="truncate">Administrace</span>
            </button>
          ) : (
            <Link
              href="/admin/dashboard"
              className="flex items-center gap-2 text-sm text-sidebar-foreground hover:text-primary transition-colors px-3 py-3 sm:py-2 border border-sidebar-border rounded-lg bg-sidebar-accent/50 min-h-[44px] sm:min-h-0 touch-manipulation"
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span className="truncate">Administrace</span>
            </Link>
          )
        ) : null}
      </div>
    </div>
  );
}
