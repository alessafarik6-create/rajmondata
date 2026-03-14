
"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Building2, 
  Users, 
  Briefcase, 
  Clock, 
  Wallet, 
  MessageSquare, 
  FileText, 
  ShieldCheck, 
  Settings,
  CreditCard,
  UserCircle,
  ReceiptText,
  CreditCard as PaymentIcon,
  BarChart3
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUser, useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';

export const BizForgeSidebar = () => {
  const pathname = usePathname();
  const { user } = useUser();
  const firestore = useFirestore();

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: userProfile } = useDoc(userRef);

  const isSuperAdmin = userProfile?.globalRoles?.includes('super_admin');
  const isAdminArea = pathname.startsWith('/admin');
  
  const role = userProfile?.role || 'employee';

  const adminLinks = [
    { label: 'Přehled', href: '/admin/dashboard', icon: LayoutDashboard },
    { label: 'Organizace', href: '/admin/companies', icon: Building2 },
    { label: 'Licence', href: '/admin/licenses', icon: ShieldCheck },
    { label: 'Fakturace', href: '/admin/billing', icon: CreditCard },
  ];

  // Definice přístupnosti modulů podle rolí
  const portalLinks = [
    { label: 'Přehled', href: '/portal/dashboard', icon: LayoutDashboard, roles: ['owner', 'admin', 'manager', 'accountant', 'employee', 'customer'] },
    { label: 'Zaměstnanci', href: '/portal/employees', icon: Users, roles: ['owner', 'admin', 'manager'] },
    { label: 'Zákazníci', href: '/portal/customers', icon: UserCircle, roles: ['owner', 'admin', 'manager', 'accountant'] },
    { label: 'Zakázky', href: '/portal/jobs', icon: Briefcase, roles: ['owner', 'admin', 'manager', 'employee', 'customer'] },
    { label: 'Docházka', href: '/portal/attendance', icon: Clock, roles: ['owner', 'admin', 'manager', 'employee'] },
    { label: 'Finance', href: '/portal/finance', icon: Wallet, roles: ['owner', 'admin', 'accountant'] },
    { label: 'Faktury', href: '/portal/invoices', icon: ReceiptText, roles: ['owner', 'admin', 'accountant', 'customer'] },
    { label: 'Doklady', href: '/portal/documents', icon: FileText, roles: ['owner', 'admin', 'accountant'] },
    { label: 'Reporty', href: '/portal/reports', icon: BarChart3, roles: ['owner', 'admin', 'manager', 'accountant'] },
    { label: 'Předplatné', href: '/portal/billing', icon: PaymentIcon, roles: ['owner'] },
    { label: 'Zprávy', href: '/portal/chat', icon: MessageSquare, roles: ['owner', 'admin', 'manager', 'accountant', 'employee'] },
    { label: 'Nastavení', href: '/portal/settings', icon: Settings, roles: ['owner', 'admin', 'manager', 'accountant', 'employee'] },
  ].filter(link => link.roles.includes(role));

  const links = isAdminArea ? adminLinks : portalLinks;

  return (
    <div className="w-64 bg-sidebar border-r flex flex-col h-full sticky top-0">
      <div className="p-6">
        <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded flex items-center justify-center text-white">B</div>
          BizForge
        </h1>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 px-2">
          {isAdminArea ? 'Administrace Platformy' : 'Firemní Portál'}
        </div>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
              pathname === link.href || (pathname.startsWith(link.href) && link.href !== '/portal/dashboard' && link.href !== '/admin/dashboard')
                ? "bg-sidebar-accent text-sidebar-primary font-medium" 
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary"
            )}
          >
            <link.icon className="w-5 h-5" />
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="p-4 mt-auto border-t">
        <div className="px-3 py-2 mb-2">
          <p className="text-[10px] text-muted-foreground uppercase font-bold">Moje Role</p>
          <p className="text-xs font-semibold text-primary capitalize">{role.replace('_', ' ')}</p>
        </div>
        {isSuperAdmin && (
          <Link 
            href={isAdminArea ? '/portal/dashboard' : '/admin/dashboard'}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors px-3 py-2 border border-border rounded-md bg-muted/20"
          >
            <ShieldCheck className="w-4 h-4" />
            Přepnout na {isAdminArea ? 'Portál' : 'Admin'}
          </Link>
        )}
      </div>
    </div>
  );
};
