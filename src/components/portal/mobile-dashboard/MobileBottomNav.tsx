"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Home, Briefcase, Clock, MessageSquare, Menu } from "lucide-react";

type NavItem = {
  key: string;
  label: string;
  href: string;
  Icon: React.ComponentType<{ className?: string }>;
  badge?: number;
};

export function MobileBottomNav(props: { unreadMessages?: number; role?: string }) {
  const pathname = usePathname();
  const role = String(props.role || "");
  const messagesHref = role === "employee" ? "/portal/employee/messages" : "/portal/chat";

  const items: NavItem[] = [
    { key: "overview", label: "Přehled", href: "/portal/dashboard", Icon: Home },
    { key: "jobs", label: "Zakázky", href: "/portal/jobs", Icon: Briefcase },
    { key: "att", label: "Docházka", href: "/portal/labor/dochazka", Icon: Clock },
    {
      key: "msg",
      label: "Zprávy",
      href: messagesHref,
      Icon: MessageSquare,
      badge: props.unreadMessages,
    },
    { key: "more", label: "Více", href: "/portal/settings", Icon: Menu },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-[70] border-t border-white/10 bg-slate-950/90 backdrop-blur supports-[backdrop-filter]:bg-slate-950/75 lg:hidden"
      aria-label="Mobilní navigace"
    >
      <div className="mx-auto grid max-w-[520px] grid-cols-5 gap-1 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2">
        {items.map((it) => {
          const active = pathname === it.href || (it.href !== "/portal/dashboard" && pathname?.startsWith(it.href));
          return (
            <Link
              key={it.key}
              href={it.href}
              className={cn(
                "relative flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl px-2 py-1 text-xs font-medium text-slate-200 outline-none transition-colors",
                active ? "bg-white/5 text-orange-300" : "hover:bg-white/5 hover:text-white"
              )}
            >
              <it.Icon className={cn("h-5 w-5", active ? "text-orange-400" : "text-slate-200")} />
              <span className="leading-none">{it.label}</span>
              {it.badge && it.badge > 0 ? (
                <Badge className="absolute right-2 top-1.5 bg-orange-500 px-1.5 py-0 text-[10px] text-slate-950">
                  {it.badge > 99 ? "99+" : it.badge}
                </Badge>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

