
"use client";

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth, useUser, useFirestore, useDoc, useMemoFirebase, useCompany } from '@/firebase';
import { closeStaffSessionAndLog, staffSessionStorageKey } from '@/lib/activity-log';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Search, LogOut, User, Menu, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/ui/logo';
import Link from 'next/link';
import { signOut } from 'firebase/auth';
import { doc } from 'firebase/firestore';
import { useUnreadEmployeeChatCount } from '@/hooks/use-unread-employee-chat';

interface TopHeaderProps {
  onOpenMobileMenu?: () => void;
}

export const TopHeader = ({ onOpenMobileMenu }: TopHeaderProps) => {
  const pathname = usePathname() || '/';
  const auth = useAuth();
  const { user } = useUser();
  const firestore = useFirestore();
  const [superadminUsername, setSuperadminUsername] = useState<string | null>(null);

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc(userRef);

  const { companyName } = useCompany();
  const { count: unreadChatCount, showBadge: showChatBadge } =
    useUnreadEmployeeChatCount();

  const isAdminArea = pathname?.startsWith('/admin');
  const isEmployeePortal = pathname?.startsWith('/portal/employee');
  const showCompanyChatShortcut = !isAdminArea && !isEmployeePortal;
  useEffect(() => {
    if (!isAdminArea) return;
    fetch('/api/superadmin/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setSuperadminUsername(data.username))
      .catch(() => {});
  }, [isAdminArea]);

  const handleLogout = () => {
    if (superadminUsername) {
      fetch('/api/superadmin/logout', { method: 'POST' }).then(() => {
        window.location.href = '/admin/login';
      });
      return;
    }
    const cid = profile?.companyId as string | undefined;
    const sid =
      typeof window !== 'undefined' && user && cid
        ? sessionStorage.getItem(staffSessionStorageKey(cid, user.uid))
        : null;
    const runSignOut = () => void signOut(auth);
    if (user && cid && firestore && sid) {
      void closeStaffSessionAndLog({
        firestore,
        companyId: cid,
        user,
        profile,
        sessionId: sid,
        route: pathname,
      }).finally(runSignOut);
    } else {
      runSignOut();
    }
  };

  const getRoleLabel = (role?: string) => {
    if (!role) return 'Uživatel';
    const roles: Record<string, string> = {
      'super_admin': 'Super Administrátor',
      'billing_admin': 'Správce Fakturace',
      'owner': 'Vlastník',
      'admin': 'Administrátor',
      'manager': 'Manažer',
      'accountant': 'Účetní',
      'employee': 'Zaměstnanec'
    };
    return roles[role] || role;
  };

  return (
    <header className="print:hidden h-14 sm:h-16 border-b border-slate-200 bg-white/90 backdrop-blur-sm sticky top-0 z-40 flex items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {onOpenMobileMenu && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 lg:hidden h-10 w-10 text-slate-700 hover:bg-slate-200"
            onClick={onOpenMobileMenu}
            aria-label="Otevřít menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}
        <Link
          href={
            isAdminArea
              ? '/admin/dashboard'
              : isEmployeePortal
                ? '/portal/employee'
                : '/portal/dashboard'
          }
          className="hidden sm:flex shrink-0 mr-1 items-center"
          aria-label="Přehled portálu"
        >
          <Logo variant="small" context="light" className="max-w-[140px] lg:max-w-[180px]" />
        </Link>
        {companyName && (
          <div className="hidden md:flex items-center gap-2 text-slate-700 font-semibold truncate max-w-xs">
            <span className="truncate">{companyName}</span>
          </div>
        )}
        <div className="relative hidden min-w-0 w-full max-w-md sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600 pointer-events-none" />
          <Input placeholder="Hledat..." className="pl-10" />
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-4 shrink-0">
        {showCompanyChatShortcut ? (
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="relative text-slate-600 hover:bg-slate-200 hover:text-slate-900 h-10 w-10 shrink-0"
          >
            <Link href="/portal/chat" aria-label="Zprávy od zaměstnanců">
              <MessageSquare className="w-5 h-5" />
              {showChatBadge && unreadChatCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white shadow-sm">
                  {unreadChatCount > 99 ? "99+" : unreadChatCount}
                </span>
              ) : null}
            </Link>
          </Button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 sm:gap-3 px-2 hover:bg-slate-200 text-slate-900 transition-colors min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 h-10 w-10 sm:h-auto sm:w-auto sm:px-2 rounded-full sm:rounded-lg" aria-label="Účet">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium leading-none text-slate-900">
                  {superadminUsername || profile?.displayName || user?.email || 'Účet'}
                </p>
                <p className="text-xs text-slate-600 mt-1 capitalize">
                  {superadminUsername
                    ? 'Super administrátor'
                    : getRoleLabel(
                        profile?.role ||
                          (Array.isArray(profile?.globalRoles)
                            ? profile?.globalRoles?.[0]
                            : undefined)
                      )}
                </p>
              </div>
              <Avatar className="h-9 w-9 border-2 border-primary/20">
                <AvatarImage
                  src={
                    profile?.photoURL ||
                    profile?.profileImage ||
                    profile?.photoUrl ||
                    undefined
                  }
                />
                <AvatarFallback className="bg-primary text-white font-bold">
                  {(superadminUsername?.[0] || profile?.displayName?.[0] || user?.email?.[0] || 'U').toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Můj účet</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {!superadminUsername && (
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link href={isEmployeePortal ? '/portal/employee/profile' : '/portal/settings'}>
                  <User className="w-4 h-4 mr-2" /> Profil
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="cursor-pointer text-destructive" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" /> Odhlásit se
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};
