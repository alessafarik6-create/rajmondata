"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePortalNotifications } from "@/components/portal/portal-notifications-context";
import { formatMediaDate } from "@/lib/job-media-types";

export default function PortalNotificationsPage() {
  const {
    items,
    isLoading,
    unreadCount,
    markAsRead,
    markAllRead,
    clearOsBadge,
    registerWebPush,
    pushSupported,
  } = usePortalNotifications();

  useEffect(() => {
    if (isLoading) return;
    if (unreadCount === 0) {
      clearOsBadge();
      return;
    }
    void markAllRead();
    clearOsBadge();
  }, [isLoading, unreadCount, markAllRead, clearOsBadge]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Bell className="h-7 w-7" aria-hidden />
            Oznámení
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Změny u vašeho účtu, zakázek a zpráv. Po otevření této stránky se oznámení označí jako přečtená a
            odznak na ikoně aplikace se smaže (pokud ho prohlížeč podporuje).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pushSupported ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void registerWebPush()}>
              Povolit push
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!unreadCount}
            onClick={() => void markAllRead()}
          >
            <CheckCheck className="h-4 w-4 mr-1" aria-hidden />
            Vše přečíst
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Seznam</CardTitle>
          <CardDescription>
            Nepřečtených: {unreadCount}
            {pushSupported
              ? " · Push vyžaduje povolení v prohlížeči a nakonfigurované VAPID klíče na serveru."
              : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Žádná oznámení.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {items.map((row) => (
                <li key={row.id}>
                  <div
                    className={`flex flex-col gap-1 p-3 text-left sm:flex-row sm:items-start sm:justify-between ${
                      !row.read ? "bg-primary/5" : ""
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium text-sm">{row.title}</p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.body}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatMediaDate(row.createdAt)} · {row.category}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2 sm:flex-col sm:items-end">
                      {row.linkUrl ? (
                        <Button variant="outline" size="sm" className="h-8" asChild>
                          <Link
                            href={row.linkUrl}
                            onClick={() => void markAsRead(row.id)}
                          >
                            Otevřít
                          </Link>
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          disabled={row.read}
                          onClick={() => void markAsRead(row.id)}
                        >
                          {row.read ? "Přečteno" : "Označit přečtené"}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
