"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Clock,
  CalendarDays,
  UserCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";

export type EmployeePortalSidebarProps = {
  mobileSheetClose?: () => void;
};

const links = [
  { label: "Hlavní stránka", href: "/portal/employee", icon: LayoutDashboard },
  { label: "Docházka", href: "/portal/employee/attendance", icon: Clock },
  { label: "Výkaz práce", href: "/portal/employee/worklogs", icon: CalendarDays },
  { label: "Profil", href: "/portal/employee/profile", icon: UserCircle },
];

export function EmployeePortalSidebar({
  mobileSheetClose,
}: EmployeePortalSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const linkClass = (href: string) => {
    const workLogActive =
      href === "/portal/employee/worklogs" &&
      (pathname.startsWith("/portal/employee/worklogs") ||
        pathname.startsWith("/portal/employee/work-log"));
    const active =
      pathname === href ||
      workLogActive ||
      (href !== "/portal/employee" &&
        !href.startsWith("/portal/employee/work") &&
        pathname.startsWith(href));
    return cn(
      "flex items-center gap-3 px-3 py-3 sm:py-2.5 rounded-lg transition-colors min-h-[44px] sm:min-h-0 touch-manipulation",
      active
        ? "bg-sidebar-accent text-sidebar-primary font-medium"
        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary"
    );
  };

  const handleMobileNav = (href: string) => {
    mobileSheetClose?.();
    window.setTimeout(() => router.push(href), 0);
  };

  return (
    <div className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col h-full sticky top-0 shrink-0">
      <div className="p-4 sm:p-6">
        <Link
          href="/portal/employee"
          className="block outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring rounded-lg"
        >
          <Logo context="sidebar" className="max-w-full" />
        </Link>
        <p className="mt-3 text-xs font-semibold text-sidebar-foreground/80 uppercase tracking-wide px-1">
          Zaměstnanec
        </p>
      </div>

      <nav className="flex-1 px-3 sm:px-4 space-y-0.5 overflow-y-auto min-h-0">
        {links.map((link) =>
          mobileSheetClose ? (
            <button
              key={link.href}
              type="button"
              className={cn(
                linkClass(link.href),
                "w-full border-0 bg-transparent text-left font-[inherit]"
              )}
              onClick={() => handleMobileNav(link.href)}
            >
              <link.icon className="w-5 h-5 shrink-0" />
              <span className="truncate">{link.label}</span>
            </button>
          ) : (
            <Link key={link.href} href={link.href} className={linkClass(link.href)}>
              <link.icon className="w-5 h-5 shrink-0" />
              <span className="truncate">{link.label}</span>
            </Link>
          )
        )}
      </nav>
    </div>
  );
}
