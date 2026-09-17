"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { adminOrganizationDetailPath } from "@/lib/platform-admin-notifications/paths";

type AdminNotificationRow = {
  id: string;
  type?: string;
  title?: string;
  message?: string;
  organizationId?: string;
  readAt?: unknown;
  createdAt?: { seconds?: number };
};

function formatTs(ts?: { seconds?: number }): string {
  if (!ts?.seconds) return "";
  return new Date(ts.seconds * 1000).toLocaleString("cs-CZ");
}

export function AdminNotificationsBell() {
  const [items, setItems] = useState<AdminNotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/superadmin/admin-notifications", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setUnreadCount(Number(data.unreadCount ?? 0));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const markRead = async (id: string) => {
    await fetch("/api/superadmin/admin-notifications", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    void load();
  };

  const hrefFor = (row: AdminNotificationRow) => {
    if (row.organizationId) return adminOrganizationDetailPath(row.organizationId);
    return "/admin/companies";
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-10 w-10" aria-label="Notifikace platformy">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-slate-950">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(100vw-2rem,22rem)]">
        <DropdownMenuLabel>Notifikace platformy</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">Žádné notifikace.</div>
        ) : (
          items.slice(0, 12).map((row) => (
            <DropdownMenuItem key={row.id} asChild className="cursor-pointer flex-col items-start gap-1 py-2">
              <Link
                href={hrefFor(row)}
                onClick={() => {
                  if (!row.readAt) void markRead(row.id);
                }}
              >
                <span className="font-medium text-sm leading-snug">{row.title || row.message}</span>
                {row.message && row.title ? (
                  <span className="text-xs text-muted-foreground line-clamp-2">{row.message}</span>
                ) : null}
                <span className="text-[10px] text-muted-foreground">{formatTs(row.createdAt)}</span>
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
