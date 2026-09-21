"use client";

import React, { useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import { useUser, useFirestore, useDoc, useMemoFirebase, useCompany } from "@/firebase";
import { doc } from "firebase/firestore";
import { useEmployeeUiLang } from "@/hooks/use-employee-ui-lang";
import { getEffectiveModulesMerged } from "@/lib/platform-access";
import { useMergedPlatformModuleCatalog } from "@/contexts/platform-module-catalog-context";
import { Badge } from "@/components/ui/badge";
import { useEmployeeNotificationUnreadCount } from "@/hooks/use-employee-notification-unread-count";
import { resolveEffectivePortalPermissions } from "@/lib/portal-permissions";
import { resolveEmployeePortalMenuItems } from "@/lib/employee-portal-menu-resolver";
import { portalMenuIcon } from "@/lib/portal-menu-icons";
import { normalizeCompanyRole } from "@/lib/company-privilege";

export type EmployeePortalSidebarProps = {
  mobileSheetClose?: () => void;
};

export function EmployeePortalSidebar({ mobileSheetClose }: EmployeePortalSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useUser();
  const firestore = useFirestore();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc<any>(userRef);
  const { t } = useEmployeeUiLang(profile);

  const employeeRef = useMemoFirebase(
    () =>
      firestore && profile?.companyId && profile?.employeeId
        ? doc(
            firestore,
            "companies",
            String(profile.companyId),
            "employees",
            String(profile.employeeId)
          )
        : null,
    [firestore, profile?.companyId, profile?.employeeId]
  );
  const { data: employeeDoc } = useDoc<any>(employeeRef);
  const { company } = useCompany();
  const companyIdStr = profile?.companyId as string | undefined;
  const employeeIdStr = profile?.employeeId as string | undefined;
  const { unreadCount: employeeNotifUnread } = useEmployeeNotificationUnreadCount({
    companyId: companyIdStr,
    employeeId: employeeIdStr,
  });
  const role = normalizeCompanyRole(String(profile?.role || "employee"));
  const platformCatalog = useMergedPlatformModuleCatalog();

  const effectiveModules = useMemo(
    () => getEffectiveModulesMerged(company),
    [company]
  );

  const portalPermissions = useMemo(
    () =>
      resolveEffectivePortalPermissions({
        role,
        globalRoles: profile?.globalRoles,
        employeeDoc: (employeeDoc as Record<string, unknown> | null) ?? null,
      }),
    [role, profile?.globalRoles, employeeDoc]
  );

  const visibilityCtx = useMemo(
    () => ({
      role,
      globalRoles: profile?.globalRoles,
      company,
      effectiveModules,
      platformCatalog,
      employeeRow: (employeeDoc as Record<string, unknown> | null) ?? null,
    }),
    [role, profile?.globalRoles, company, effectiveModules, platformCatalog, employeeDoc]
  );

  const navItems = useMemo(
    () =>
      resolveEmployeePortalMenuItems({
        visibilityCtx,
        permissions: portalPermissions,
        role,
        globalRoles: profile?.globalRoles,
        employeeDoc: (employeeDoc as Record<string, unknown> | null) ?? null,
        labels: {
          home: t("home"),
          workReport: t("workReport"),
          attendance: t("attendance"),
          money: t("money"),
          notifications: "Oznámení",
          profile: t("profile"),
        },
      }),
    [
      visibilityCtx,
      portalPermissions,
      role,
      profile?.globalRoles,
      employeeDoc,
      t,
    ]
  );

  const links = useMemo(
    () =>
      navItems.map((item) => ({
        id: item.id,
        label: item.label,
        href: item.href,
        icon:
          item.id === "_home"
            ? LayoutDashboard
            : item.id === "_notifications"
              ? Bell
              : portalMenuIcon(item.id),
      })),
    [navItems]
  );

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (!profile?.employeeId || !companyIdStr) return;
    console.log("[EmployeePortalSidebar] menu", {
      employeeId: profile.employeeId,
      companyId: companyIdStr,
      portalModulePermissions: employeeDoc?.portalModulePermissions ?? null,
      resolvedPermissions: portalPermissions,
      menuItems: navItems.map((i) => ({ id: i.id, href: i.href, label: i.label })),
    });
  }, [
    profile?.employeeId,
    companyIdStr,
    employeeDoc?.portalModulePermissions,
    portalPermissions,
    navItems,
  ]);

  const linkClass = (href: string) =>
    cn(
      "flex w-full min-w-0 items-center gap-3 px-3 py-3 sm:py-2.5 rounded-lg transition-colors min-h-[44px] sm:min-h-0 touch-manipulation",
      pathname === href ||
        (href !== "/portal/employee" &&
          href !== "/portal/sklad" &&
          href !== "/portal/vyroba" &&
          href !== "/portal/employee/jobs" &&
          pathname.startsWith(href)) ||
        (href === "/portal/sklad" && pathname.startsWith("/portal/sklad")) ||
        (href === "/portal/vyroba" && pathname.startsWith("/portal/vyroba")) ||
        (href === "/portal/employee/jobs" &&
          pathname.startsWith("/portal/employee/jobs"))
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
          href="/portal/employee"
          className="block outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring rounded-lg"
        >
          <Logo context="sidebar" className="max-w-full" />
        </Link>
        <p className="mt-3 text-xs font-semibold text-sidebar-foreground/80 uppercase tracking-wide px-1">
          {t("employeeSection")}
        </p>
      </div>

      <nav className="flex-1 px-3 sm:px-4 space-y-0.5 overflow-y-auto min-h-0">
        {links.map((link) =>
          mobileSheetClose ? (
            <button
              key={`${link.id}-${link.href}`}
              type="button"
              className={cn(
                linkClass(link.href),
                "w-full border-0 bg-transparent text-left font-[inherit]"
              )}
              onClick={() => handleMobileNav(link.href)}
            >
              <link.icon className="w-5 h-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{link.label}</span>
              {link.href === "/portal/employee" && employeeNotifUnread > 0 ? (
                <Badge
                  variant="destructive"
                  className="ml-auto shrink-0 px-1.5 text-[10px] tabular-nums"
                >
                  {employeeNotifUnread > 99 ? "99+" : employeeNotifUnread}
                </Badge>
              ) : null}
            </button>
          ) : (
            <Link
              key={`${link.id}-${link.href}`}
              href={link.href}
              className={linkClass(link.href)}
            >
              <link.icon className="w-5 h-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{link.label}</span>
              {link.href === "/portal/employee" && employeeNotifUnread > 0 ? (
                <Badge
                  variant="destructive"
                  className="ml-auto shrink-0 px-1.5 text-[10px] tabular-nums"
                >
                  {employeeNotifUnread > 99 ? "99+" : employeeNotifUnread}
                </Badge>
              ) : null}
            </Link>
          )
        )}
      </nav>
    </div>
  );
}
