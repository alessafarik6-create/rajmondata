
"use client";

import React, { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  Briefcase,
  FileText,
  ShieldCheck,
  Settings,
  CreditCard,
  CreditCard as PaymentIcon,
  BarChart3,
  Tags,
  CircleHelp,
  LifeBuoy,
  Sparkles,
  ShieldAlert,
  Landmark,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/ui/logo';
import { useUser, useDoc, useFirestore, useMemoFirebase, useCompany } from '@/firebase';
import { doc } from 'firebase/firestore';
import { normalizeModules } from '@/lib/license-modules';
import { getEffectiveModulesMerged } from '@/lib/platform-access';
import { useMergedPlatformModuleCatalog } from '@/contexts/platform-module-catalog-context';
import {
  hiddenBecauseNotSidebarModule,
  PORTAL_SIDEBAR_MENU_DEFS,
} from '@/lib/portal-menu-config';
import { PORTAL_MENU_ICONS } from '@/lib/portal-menu-icons';
import {
  debugPortalMenuItemHiddenReason,
  isPortalMenuItemVisible,
} from '@/lib/portal-menu-visibility';
import { FLEET_PORTAL_MODULE_ID } from '@/lib/portal-menu-fleet-access';
import {
  canAccessPortalModule,
  resolveEffectivePortalPermissions,
  type PortalModuleId,
} from '@/lib/portal-permissions';
import type { LucideIcon } from 'lucide-react';

type PortalNavLink = { label: string; href: string; icon: LucideIcon; navId?: string };

const adminLinksStatic: PortalNavLink[] = [
  { label: 'Přehled', href: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Analytika', href: '/admin/analytics', icon: BarChart3 },
  { label: 'Bezpečnost', href: '/admin/security', icon: ShieldAlert },
  { label: 'Organizace', href: '/admin/companies', icon: Building2 },
  { label: 'Moduly', href: '/admin/modules', icon: Briefcase },
  { label: 'Ceník', href: '/admin/pricing', icon: Tags },
  { label: 'SEO', href: '/admin/seo', icon: FileText },
  { label: 'Nastavení platformy', href: '/admin/platform-settings', icon: Settings },
  { label: 'Provozovatel / fakturace', href: '/admin/billing-provider', icon: Landmark },
  { label: 'Licence', href: '/admin/licenses', icon: ShieldCheck },
  { label: 'Fakturace', href: '/admin/billing', icon: CreditCard },
  { label: 'Podpora / dotazy', href: '/admin/support-tickets', icon: LifeBuoy },
  { label: 'Nápověda portálu', href: '/admin/help-content', icon: CircleHelp },
  { label: 'Průvodce portálem', href: '/admin/onboarding', icon: Sparkles },
];

export type BizForgeSidebarProps = {
  /**
   * Mobilní Sheet (Radix Dialog): po kliknutí nejdřív zavřít menu, navigaci až v dalším ticku.
   * Eliminuje NotFoundError removeChild při současném unmountu portálu a Next.js navigaci.
   */
  mobileSheetClose?: () => void;
};

export const BizForgeSidebar = ({ mobileSheetClose }: BizForgeSidebarProps) => {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useUser();
  const firestore = useFirestore();

  const userRef = useMemoFirebase(
    () => (user ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: userProfile } = useDoc(userRef);
  const { company, companyId } = useCompany();

  const isSuperAdmin = userProfile?.globalRoles?.includes('super_admin');
  const isAdminArea = pathname.startsWith('/admin');

  const role = userProfile?.role || 'employee';

  const employeeRowRef = useMemoFirebase(
    () =>
      firestore && companyId && userProfile?.employeeId
        ? doc(
            firestore,
            'companies',
            companyId,
            'employees',
            String(userProfile.employeeId)
          )
        : null,
    [firestore, companyId, userProfile?.employeeId]
  );
  const { data: employeeRow } = useDoc(employeeRowRef);
  const platformCatalog = useMergedPlatformModuleCatalog();

  const effectiveModules = useMemo(() => getEffectiveModulesMerged(company), [company]);

  const portalLinks = useMemo((): PortalNavLink[] => {
    if (isAdminArea) return [];
    const ctx = {
      role,
      globalRoles: userProfile?.globalRoles,
      company,
      effectiveModules,
      platformCatalog,
      employeeRow: (employeeRow as Record<string, unknown> | null) ?? null,
    };

    const portalPermissions = resolveEffectivePortalPermissions({
      role,
      globalRoles: userProfile?.globalRoles,
      employeeDoc: (employeeRow as Record<string, unknown> | null) ?? null,
    });

    const filtered = PORTAL_SIDEBAR_MENU_DEFS.filter((def) => {
      const modId = def.id as PortalModuleId;
      const permOk = canAccessPortalModule(portalPermissions, modId, "read");
      const visible = isPortalMenuItemVisible(def, ctx);
      if (process.env.NODE_ENV === "development" && def.id === FLEET_PORTAL_MODULE_ID) {
        const hiddenReason = debugPortalMenuItemHiddenReason(def, ctx, permOk);
        console.log("NAVIGATION_ITEM_FLEET", {
          visible,
          permissionRead: permOk,
          hiddenReason,
          role,
          moduleEnabled: ctx.effectiveModules.vozovyPark,
          fleetPermission: portalPermissions.fleet,
        });
      }
      if (!visible) return false;
      return permOk;
    });

    return filtered.map((def) => ({
      label: def.label,
      href: def.href,
      icon: PORTAL_MENU_ICONS[def.id] ?? LayoutDashboard,
      navId: def.id,
    }));
  }, [
    isAdminArea,
    company,
    role,
    userProfile?.globalRoles,
    platformCatalog,
    employeeRow,
    effectiveModules,
  ]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || isAdminArea) return;

    const licRaw = (company?.license?.modules ?? {}) as Record<string, boolean>;
    const orgRaw = (company?.modules ?? {}) as Record<string, boolean>;
    const normalizedLicenseModules = normalizeModules(licRaw);
    const normalizedOrganizationModules = normalizeModules(orgRaw);
    const effectiveMergedDocOnly = {
      ...normalizedLicenseModules,
      ...normalizedOrganizationModules,
    };

    const ctx = {
      role,
      globalRoles: userProfile?.globalRoles,
      company,
      effectiveModules,
      platformCatalog,
      employeeRow: (employeeRow as Record<string, unknown> | null) ?? null,
    };

    const visibleDefs = PORTAL_SIDEBAR_MENU_DEFS.filter((def) =>
      isPortalMenuItemVisible(def, ctx)
    );
    const visibleSystemItems = visibleDefs.filter((d) => d.type === 'system').map((d) => d.label);
    const visibleModuleItems = visibleDefs.filter((d) => d.type === 'module').map((d) => d.label);
    const visibleChildItems = visibleDefs.filter((d) => d.type === 'child').map((d) => d.label);

    console.log('effectiveModules', effectiveModules);
    console.log('visibleSystemItems', visibleSystemItems);
    console.log('visibleModuleItems', visibleModuleItems);
    console.log('visibleChildItems', visibleChildItems);
    console.log('hiddenBecauseNotSidebarModule', [...hiddenBecauseNotSidebarModule]);

    console.log('license.modules raw', company?.license?.modules);
    console.log('organization.modules raw', company?.modules);
    console.log('normalizedLicenseModules', normalizedLicenseModules);
    console.log('normalizedOrganizationModules', normalizedOrganizationModules);
    console.log('effectiveModules (doc layers only)', effectiveMergedDocOnly);
    console.log('visible menu labels', portalLinks.map((l) => l.label));
    console.log('[BizForgeSidebar] role', role);
  }, [
    isAdminArea,
    company?.license?.modules,
    company?.modules,
    company?.license?.status,
    company?.license?.licenseStatus,
    effectiveModules,
    portalLinks,
    role,
    userProfile?.globalRoles,
    platformCatalog,
    employeeRow,
  ]);

  const links = isAdminArea ? adminLinksStatic : portalLinks;

  const isPortalLinkActive = (href: string) => {
    if (pathname === href) return true;
    if (href === "/portal/dashboard" || href === "/admin/dashboard") return false;
    /** „Zaměstnanci“ jen přesná shoda — podstránky (např. payroll) mají vlastní položku. */
    if (href === "/portal/employees") return false;
    if (href === "/portal/documents") {
      return pathname.startsWith("/portal/documents");
    }
    if (href === "/portal/invoices") {
      return pathname.startsWith("/portal/invoices");
    }
    if (href === "/portal/labor/dochazka") {
      return pathname.startsWith("/portal/labor");
    }
    if (href === "/portal/sklad") {
      return pathname.startsWith("/portal/sklad");
    }
    if (href === "/portal/vyroba") {
      return pathname.startsWith("/portal/vyroba");
    }
    if (href === "/portal/meeting-records") {
      return pathname === href || pathname.startsWith(`${href}/`);
    }
    if (href === "/portal/help") {
      return pathname === href || pathname.startsWith(`${href}/`);
    }
    return pathname.startsWith(`${href}/`);
  };

  const linkClass = (href: string) =>
    cn(
      "flex w-full min-w-0 items-center gap-3 px-3 py-3 sm:py-2.5 rounded-lg transition-colors min-h-[44px] sm:min-h-0 touch-manipulation",
      isPortalLinkActive(href)
        ? "bg-sidebar-accent text-sidebar-primary font-medium"
        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary"
    );

  const handleMobileNav = (href: string) => {
    mobileSheetClose?.();
    window.setTimeout(() => {
      router.push(href);
    }, 0);
  };

  return (
    <div className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col h-full sticky top-0 shrink-0">
      <div className="p-4 sm:p-6">
        <Link
          href={isAdminArea ? '/admin/dashboard' : '/portal/dashboard'}
          className="block outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring rounded-lg"
        >
          <Logo context="sidebar" className="max-w-full" />
        </Link>
      </div>

      <nav className="flex-1 px-3 sm:px-4 space-y-0.5 overflow-y-auto min-h-0">
        <div className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wider mb-3 px-3 pt-2">
          {isAdminArea ? 'Administrace' : 'Firemní Portál'}
        </div>
        {links.map((link) =>
          mobileSheetClose ? (
            <button
              key={link.href}
              type="button"
              data-onboarding-nav={link.navId}
              className={cn(
                linkClass(link.href),
                "w-full border-0 bg-transparent text-left font-[inherit]"
              )}
              onClick={() => handleMobileNav(link.href)}
            >
              <link.icon className="w-5 h-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{link.label}</span>
            </button>
          ) : (
            <Link
              key={link.href}
              href={link.href}
              data-onboarding-nav={link.navId}
              className={linkClass(link.href)}
            >
              <link.icon className="w-5 h-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{link.label}</span>
            </Link>
          )
        )}
      </nav>

      <div className="p-3 sm:p-4 mt-auto border-t border-sidebar-border shrink-0">
        <div className="px-3 py-2 mb-2">
          <p className="text-[10px] text-sidebar-foreground/70 uppercase font-bold">Moje Role</p>
          <p className="text-xs font-semibold text-primary capitalize truncate">{role.replace('_', ' ')}</p>
        </div>
        {isSuperAdmin &&
          (mobileSheetClose ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left text-sm text-sidebar-foreground hover:text-primary transition-colors px-3 py-3 sm:py-2 border border-sidebar-border rounded-lg bg-sidebar-accent/50 min-h-[44px] sm:min-h-0 touch-manipulation"
              onClick={() =>
                handleMobileNav(
                  isAdminArea ? "/portal/dashboard" : "/admin/dashboard"
                )
              }
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span className="truncate">
                Přepnout na {isAdminArea ? "Portál" : "Admin"}
              </span>
            </button>
          ) : (
            <Link
              href={isAdminArea ? "/portal/dashboard" : "/admin/dashboard"}
              className="flex items-center gap-2 text-sm text-sidebar-foreground hover:text-primary transition-colors px-3 py-3 sm:py-2 border border-sidebar-border rounded-lg bg-sidebar-accent/50 min-h-[44px] sm:min-h-0 touch-manipulation"
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span className="truncate">
                Přepnout na {isAdminArea ? "Portál" : "Admin"}
              </span>
            </Link>
          ))}
      </div>
    </div>
  );
};
