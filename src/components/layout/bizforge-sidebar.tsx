
"use client";

import React, { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  LayoutDashboard, 
  Building2, 
  Users, 
  Briefcase,
  Inbox,
  Wallet, 
  MessageSquare, 
  FileText, 
  ShieldCheck, 
  Settings,
  CreditCard,
  UserCircle,
  CreditCard as PaymentIcon,
  BarChart3,
  Tags,
  Activity,
  Package,
  Factory,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/ui/logo';
import { useUser, useDoc, useFirestore, useMemoFirebase, useCompany } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { PlatformModuleCode } from '@/lib/platform-config';
import { isModuleKeyEnabled, normalizeModules } from '@/lib/license-modules';
import {
  canAccessCompanyModule,
  getEffectiveModulesMerged,
  getResolvedMenuModules,
  isLicenseExplicitlyRevokedForPortal,
} from '@/lib/platform-access';
import {
  userCanAccessProductionPortal,
  userCanAccessWarehousePortal,
} from '@/lib/warehouse-production-access';
import { useMergedPlatformModuleCatalog } from '@/contexts/platform-module-catalog-context';

type PortalLinkDef = {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  roles: string[];
  module: PlatformModuleCode | null;
  menuGateKeys?: readonly string[];
};

const adminLinksStatic = [
  { label: 'Přehled', href: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Organizace', href: '/admin/companies', icon: Building2 },
  { label: 'Moduly', href: '/admin/modules', icon: Briefcase },
  { label: 'Ceník', href: '/admin/pricing', icon: Tags },
  { label: 'SEO', href: '/admin/seo', icon: FileText },
  { label: 'Nastavení platformy', href: '/admin/platform-settings', icon: Settings },
  { label: 'Licence', href: '/admin/licenses', icon: ShieldCheck },
  { label: 'Fakturace', href: '/admin/billing', icon: CreditCard },
];

const portalLinksRawStatic: PortalLinkDef[] = [
  { label: 'Přehled', href: '/portal/dashboard', icon: LayoutDashboard, roles: ['owner', 'admin', 'manager', 'accountant', 'employee', 'customer'], module: null },
  { label: 'Zaměstnanci', href: '/portal/employees', icon: Users, roles: ['owner', 'admin', 'manager'], module: 'attendance_payroll', menuGateKeys: ['dochazka', 'attendance', 'mobile_terminal', 'terminal', 'reporty', 'reports'] },
  { label: 'Práce a mzdy', href: '/portal/labor/dochazka', icon: Wallet, roles: ['owner', 'admin', 'manager', 'accountant', 'employee'], module: 'attendance_payroll', menuGateKeys: ['dochazka', 'attendance', 'mobile_terminal', 'terminal', 'reporty', 'reports'] },
  { label: 'Zákazníci', href: '/portal/customers', icon: UserCircle, roles: ['owner', 'admin', 'manager', 'accountant'], module: 'jobs', menuGateKeys: ['zakazky', 'jobs'] },
  { label: 'Zakázky', href: '/portal/jobs', icon: Briefcase, roles: ['owner', 'admin', 'manager', 'employee', 'customer'], module: 'jobs', menuGateKeys: ['zakazky', 'jobs'] },
  { label: 'Poptávky', href: '/portal/leads', icon: Inbox, roles: ['owner', 'admin', 'manager', 'accountant', 'employee'], module: 'jobs', menuGateKeys: ['zakazky', 'jobs'] },
  { label: 'Finance', href: '/portal/finance', icon: Wallet, roles: ['owner', 'admin', 'accountant'], module: 'invoicing', menuGateKeys: ['finance', 'faktury', 'invoices', 'doklady', 'documents'] },
  { label: 'Doklady', href: '/portal/documents', icon: FileText, roles: ['owner', 'admin', 'accountant', 'customer'], module: 'invoicing', menuGateKeys: ['finance', 'faktury', 'invoices', 'doklady', 'documents'] },
  { label: 'Report', href: '/portal/report', icon: Activity, roles: ['owner', 'admin'], module: null },
  { label: 'Reporty', href: '/portal/reports', icon: BarChart3, roles: ['owner', 'admin', 'manager', 'accountant'], module: 'attendance_payroll', menuGateKeys: ['dochazka', 'attendance', 'mobile_terminal', 'terminal', 'reporty', 'reports'] },
  { label: 'Předplatné', href: '/portal/billing', icon: PaymentIcon, roles: ['owner'], module: null },
  { label: 'Zprávy', href: '/portal/chat', icon: MessageSquare, roles: ['owner', 'admin', 'manager', 'accountant', 'employee'], module: null },
  { label: 'Nastavení', href: '/portal/settings', icon: Settings, roles: ['owner', 'admin', 'manager', 'accountant', 'employee'], module: null },
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
      firestore &&
      companyId &&
      userProfile?.employeeId &&
      role === 'employee'
        ? doc(
            firestore,
            'companies',
            companyId,
            'employees',
            String(userProfile.employeeId)
          )
        : null,
    [firestore, companyId, userProfile?.employeeId, role]
  );
  const { data: employeeRow } = useDoc(employeeRowRef);
  const platformCatalog = useMergedPlatformModuleCatalog();

  const organizationModules = company?.modules ?? {};
  const licenseModulesNested = company?.license?.modules ?? {};
  const effectiveModules = useMemo(() => getEffectiveModulesMerged(company), [company]);
  const modules = useMemo(() => getResolvedMenuModules(company), [company]);
  const isModuleEnabled = (key: string) => isModuleKeyEnabled(effectiveModules, key);

  const portalLinks = useMemo(() => {
    return portalLinksRawStatic.filter((link) => {
      if (link.href === '/portal/report') {
        if (!company) return false;
        return (
          role === 'owner' ||
          role === 'admin' ||
          (Array.isArray(userProfile?.globalRoles) &&
            userProfile.globalRoles.includes('super_admin'))
        );
      }
      if (!link.roles.includes(role)) return false;
      if (link.module === null) return true;
      if (!company) return false;

      const gateKeys = link.menuGateKeys;
      const anyGate =
        gateKeys && gateKeys.length > 0
          ? gateKeys.some((k) => isModuleEnabled(k))
          : false;
      const catalogOrEntitlements = canAccessCompanyModule(
        company,
        link.module,
        platformCatalog
      );
      const revoked = isLicenseExplicitlyRevokedForPortal(company);
      const moduleOk = (!revoked && anyGate) || catalogOrEntitlements;
      if (!moduleOk) return false;

      if (link.module === 'sklad') {
        return userCanAccessWarehousePortal({
          role,
          globalRoles: userProfile?.globalRoles,
          employeeRow: employeeRow as { canAccessWarehouse?: boolean } | null,
        });
      }
      if (link.module === 'vyroba') {
        return userCanAccessProductionPortal({
          role,
          globalRoles: userProfile?.globalRoles,
          employeeRow: employeeRow as { canAccessProduction?: boolean } | null,
        });
      }
      return true;
    });
  }, [
    company,
    role,
    userProfile?.globalRoles,
    platformCatalog,
    employeeRow,
    effectiveModules,
  ]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const licRaw = (company?.license?.modules ?? {}) as Record<string, boolean>;
    const orgRaw = (company?.modules ?? {}) as Record<string, boolean>;
    const normalizedLicenseModules = normalizeModules(licRaw);
    const normalizedOrganizationModules = normalizeModules(orgRaw);
    const effectiveMergedDocOnly = {
      ...normalizedLicenseModules,
      ...normalizedOrganizationModules,
    };
    const visibleMenuItems = portalLinks.map((l) => l.label);
    console.log('license.modules raw', company?.license?.modules);
    console.log('organization.modules raw', company?.modules);
    console.log('normalizedLicenseModules', normalizedLicenseModules);
    console.log('normalizedOrganizationModules', normalizedOrganizationModules);
    console.log('effectiveModules (doc layers only)', effectiveMergedDocOnly);
    console.log('effectiveModules (full, incl. enabledModules)', effectiveModules);
    console.log('visible menu items', visibleMenuItems);
    console.log('[BizForgeSidebar] role', role);
  }, [
    company?.license?.modules,
    company?.modules,
    company?.license?.status,
    company?.license?.licenseStatus,
    effectiveModules,
    portalLinks,
    role,
  ]);

  const links = isAdminArea ? adminLinksStatic : portalLinks;

  const isPortalLinkActive = (href: string) => {
    if (pathname === href) return true;
    if (href === "/portal/dashboard" || href === "/admin/dashboard") return false;
    /** „Zaměstnanci“ jen přesná shoda — podstránky (např. payroll) mají vlastní položku. */
    if (href === "/portal/employees") return false;
    /** Faktury jsou pod jednotnou sekcí Doklady — zvýraznit i detail / úpravu faktury. */
    if (href === "/portal/documents") {
      return (
        pathname.startsWith("/portal/documents") ||
        pathname.startsWith("/portal/invoices")
      );
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
            <Link key={link.href} href={link.href} className={linkClass(link.href)}>
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
