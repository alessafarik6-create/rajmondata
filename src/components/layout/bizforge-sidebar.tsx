
"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  LayoutDashboard, 
  Building2, 
  Users, 
  Briefcase, 
  Wallet, 
  MessageSquare, 
  FileText, 
  ShieldCheck, 
  Settings,
  CreditCard,
  UserCircle,
  ReceiptText,
  CreditCard as PaymentIcon,
  BarChart3,
  Tags,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/ui/logo';
import { useUser, useDoc, useFirestore, useMemoFirebase, useCompany } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { PlatformModuleCode } from '@/lib/platform-config';
import { hasActiveModuleAccess, isCompanyLicenseBlocking } from '@/lib/platform-access';

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
  const { company } = useCompany();

  const isSuperAdmin = userProfile?.globalRoles?.includes('super_admin');
  const isAdminArea = pathname.startsWith('/admin');
  
  const role = userProfile?.role || 'employee';

  const adminLinks = [
    { label: 'Přehled', href: '/admin/dashboard', icon: LayoutDashboard },
    { label: 'Organizace', href: '/admin/companies', icon: Building2 },
    { label: 'Moduly', href: '/admin/modules', icon: Briefcase },
    { label: 'Ceník', href: '/admin/pricing', icon: Tags },
    { label: 'SEO', href: '/admin/seo', icon: FileText },
    { label: 'Nastavení platformy', href: '/admin/platform-settings', icon: Settings },
    { label: 'Licence', href: '/admin/licenses', icon: ShieldCheck },
    { label: 'Fakturace', href: '/admin/billing', icon: CreditCard },
  ];

  // Modul (`null` = vždy po schválení účtu; jinak placený modul platformy)
  const portalLinksRaw: Array<{
    label: string;
    href: string;
    icon: typeof LayoutDashboard;
    roles: string[];
    module: PlatformModuleCode | null;
  }> = [
    { label: 'Přehled', href: '/portal/dashboard', icon: LayoutDashboard, roles: ['owner', 'admin', 'manager', 'accountant', 'employee', 'customer'], module: null },
    { label: 'Zaměstnanci', href: '/portal/employees', icon: Users, roles: ['owner', 'admin', 'manager'], module: 'attendance_payroll' },
    { label: 'Práce a mzdy', href: '/portal/labor/dochazka', icon: Wallet, roles: ['owner', 'admin', 'manager', 'accountant', 'employee'], module: 'attendance_payroll' },
    { label: 'Zákazníci', href: '/portal/customers', icon: UserCircle, roles: ['owner', 'admin', 'manager', 'accountant'], module: 'jobs' },
    { label: 'Zakázky', href: '/portal/jobs', icon: Briefcase, roles: ['owner', 'admin', 'manager', 'employee', 'customer'], module: 'jobs' },
    { label: 'Finance', href: '/portal/finance', icon: Wallet, roles: ['owner', 'admin', 'accountant'], module: 'invoicing' },
    { label: 'Faktury', href: '/portal/invoices', icon: ReceiptText, roles: ['owner', 'admin', 'accountant', 'customer'], module: 'invoicing' },
    { label: 'Doklady', href: '/portal/documents', icon: FileText, roles: ['owner', 'admin', 'accountant'], module: 'invoicing' },
    { label: 'Reporty', href: '/portal/reports', icon: BarChart3, roles: ['owner', 'admin', 'manager', 'accountant'], module: 'attendance_payroll' },
    { label: 'Předplatné', href: '/portal/billing', icon: PaymentIcon, roles: ['owner'], module: null },
    { label: 'Zprávy', href: '/portal/chat', icon: MessageSquare, roles: ['owner', 'admin', 'manager', 'accountant', 'employee'], module: null },
    { label: 'Nastavení', href: '/portal/settings', icon: Settings, roles: ['owner', 'admin', 'manager', 'accountant', 'employee'], module: null },
  ];

  const portalLinks = portalLinksRaw.filter((link) => {
    if (!link.roles.includes(role)) return false;
    if (link.module === null) return true;
    if (!company) return false;
    if (isCompanyLicenseBlocking(company)) return false;
    return hasActiveModuleAccess(company, link.module);
  });

  const links = isAdminArea ? adminLinks : portalLinks;

  const isPortalLinkActive = (href: string) => {
    if (pathname === href) return true;
    if (href === "/portal/dashboard" || href === "/admin/dashboard") return false;
    /** „Zaměstnanci“ jen přesná shoda — podstránky (např. payroll) mají vlastní položku. */
    if (href === "/portal/employees") return false;
    if (href === "/portal/labor/dochazka") {
      return pathname.startsWith("/portal/labor");
    }
    return pathname.startsWith(`${href}/`);
  };

  const linkClass = (href: string) =>
    cn(
      "flex items-center gap-3 px-3 py-3 sm:py-2.5 rounded-lg transition-colors min-h-[44px] sm:min-h-0 touch-manipulation",
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
