
"use client";

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth, useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Bell, Search, LogOut, User, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signOut } from 'firebase/auth';
import { doc } from 'firebase/firestore';

interface TopHeaderProps {
  onOpenMobileMenu?: () => void;
}

export const TopHeader = ({ onOpenMobileMenu }: TopHeaderProps) => {
  const pathname = usePathname();
  const auth = useAuth();
  const { user } = useUser();
  const firestore = useFirestore();
  const [superadminUsername, setSuperadminUsername] = useState<string | null>(null);

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);

  const isAdminArea = pathname?.startsWith('/admin');
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
    } else {
      signOut(auth);
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
    <header className="h-14 sm:h-16 border-b border-slate-200 bg-white/90 backdrop-blur-sm sticky top-0 z-40 flex items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
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
        <div className="relative w-full max-w-md hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input 
            placeholder="Hledat..." 
            className="pl-10 bg-white border-slate-200 text-slate-900 placeholder:text-slate-500 focus-visible:ring-primary h-9 min-h-10"
          />
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-4 shrink-0">
        <Button variant="ghost" size="icon" className="relative text-slate-600 hover:bg-slate-200 hover:text-slate-900 h-10 w-10 shrink-0" aria-label="Oznámení">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full"></span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 sm:gap-3 px-2 hover:bg-slate-200 text-slate-900 transition-colors min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 h-10 w-10 sm:h-auto sm:w-auto sm:px-2 rounded-full sm:rounded-lg" aria-label="Účet">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium leading-none text-slate-900">
                  {superadminUsername || profile?.displayName || user?.email || 'Účet'}
                </p>
                <p className="text-xs text-slate-500 mt-1 capitalize">
                  {superadminUsername ? 'Super administrátor' : getRoleLabel(profile?.globalRoles?.[0])}
                </p>
              </div>
              <Avatar className="h-9 w-9 border-2 border-primary/20">
                <AvatarImage src={profile?.photoUrl} />
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
              <DropdownMenuItem className="cursor-pointer">
                <User className="w-4 h-4 mr-2" /> Profil
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
