
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
  UserCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/mock-auth';

export const BizForgeSidebar = () => {
  const pathname = usePathname();
  const { user } = useAuth();

  const isAdminArea = pathname.startsWith('/admin');
  
  const adminLinks = [
    { label: 'Overview', href: '/admin/dashboard', icon: LayoutDashboard },
    { label: 'Companies', href: '/admin/companies', icon: Building2 },
    { label: 'Licenses', href: '/admin/licenses', icon: ShieldCheck },
    { label: 'Billing', href: '/admin/billing', icon: CreditCard },
  ];

  const portalLinks = [
    { label: 'Dashboard', href: '/portal/dashboard', icon: LayoutDashboard },
    { label: 'Employees', href: '/portal/employees', icon: Users },
    { label: 'Customers', href: '/portal/customers', icon: UserCircle },
    { label: 'Jobs', href: '/portal/jobs', icon: Briefcase },
    { label: 'Attendance', href: '/portal/attendance', icon: Clock },
    { label: 'Finance', href: '/portal/finance', icon: Wallet },
    { label: 'Chat', href: '/portal/chat', icon: MessageSquare },
    { label: 'Documents', href: '/portal/documents', icon: FileText },
    { label: 'Settings', href: '/portal/settings', icon: Settings },
  ];

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
          {isAdminArea ? 'Global Admin' : 'Company Portal'}
        </div>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
              pathname === link.href 
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
        {user?.role === 'super_admin' && (
          <Link 
            href={isAdminArea ? '/portal/dashboard' : '/admin/dashboard'}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors px-3 py-2"
          >
            <ShieldCheck className="w-4 h-4" />
            Switch to {isAdminArea ? 'Portal' : 'Admin'}
          </Link>
        )}
      </div>
    </div>
  );
};
