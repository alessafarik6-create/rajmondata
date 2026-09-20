"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, Loader2, Send, Smartphone } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePortalNotifications } from "@/components/portal/portal-notifications-context";
import { formatMediaDate } from "@/lib/job-media-types";
import { useToast } from "@/hooks/use-toast";

export default function PortalNotificationsPage() {
  const { toast } = useToast();
  const [pushBusy, setPushBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const {
    items,
    isLoading,
    unreadCount,
    markAsRead,
    markAllRead,
    registerWebPush,
    sendTestPush,
    pushSupported,
    pushDiagnostics,
    refreshPushDiagnostics,
  } = usePortalNotifications();

  const pushActive =
    pushDiagnostics.subscriptionActive &&
    pushDiagnostics.permission === "granted" &&
    pushDiagnostics.vapidConfigured;

  const onEnablePush = async () => {
    setPushBusy(true);
    try {
      const r = await registerWebPush();
      toast({
        title: r.ok ? "Push aktivní" : "Push",
        description: r.message,
        variant: r.ok ? "default" : "destructive",
      });
      if (r.ok) {
        const test = await sendTestPush();
        if (test.ok) {
          toast({ title: "Test", description: test.message });
        }
      }
    } finally {
      setPushBusy(false);
    }
  };

  const onTestPush = async () => {
    setTestBusy(true);
    try {
      const r = await sendTestPush();
      toast({
        title: r.ok ? "Test odeslán" : "Test selhal",
        description: r.message,
        variant: r.ok ? "default" : "destructive",
      });
    } finally {
      setTestBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Bell className="h-7 w-7" aria-hidden />
            Oznámení
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            In-app zvoněk a Web Push pro nainstalovanou PWA. Nepřečtených: {unreadCount}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          <CardTitle className="text-base flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            Push na tomto zařízení
          </CardTitle>
          <CardDescription>
            {pushSupported
              ? pushActive
                ? "Push oznámení: Aktivní"
                : pushDiagnostics.vapidConfigured
                  ? "Push: Nepovoleno — povolte tlačítkem níže."
                  : "Administrátorská konfigurace push oznámení není dokončena (VAPID klíče)."
              : "Web Push není v tomto prohlížeči podporován."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span>Stav:</span>
            {pushActive ? (
              <Badge className="bg-green-600">● Aktivní</Badge>
            ) : (
              <Badge variant="outline">○ Nepovoleno</Badge>
            )}
            <span className="text-muted-foreground">Zařízení: {pushDiagnostics.deviceLabel}</span>
          </div>
          {pushDiagnostics.iosHomeScreenHint ? (
            <p className="text-amber-700 dark:text-amber-400 text-xs">
              iOS: přidejte Rajmondata na Domovskou obrazovku a povolte oznámení (iOS 16.4+).
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {pushSupported && !pushActive ? (
              <Button type="button" size="sm" disabled={pushBusy} onClick={() => void onEnablePush()}>
                {pushBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Povolit push
              </Button>
            ) : null}
            {pushSupported && pushDiagnostics.vapidConfigured ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={testBusy}
                onClick={() => void onTestPush()}
              >
                {testBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                Poslat testovací oznámení
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" onClick={() => void refreshPushDiagnostics()}>
              Obnovit stav
            </Button>
          </div>
          {pushDiagnostics.lastPushError ? (
            <p className="text-xs text-destructive">Poslední chyba push: {pushDiagnostics.lastPushError}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Seznam</CardTitle>
          <CardDescription>Důležité události podle vašich oprávnění a předvoleb v Nastavení.</CardDescription>
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
                          <Link href={row.linkUrl} onClick={() => void markAsRead(row.id)}>
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
