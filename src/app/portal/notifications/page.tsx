"use client";

import React, { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Briefcase,
  Calendar,
  CheckCheck,
  ChevronRight,
  Loader2,
  Mail,
  MessageSquare,
  Send,
  Smartphone,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  usePortalNotifications,
  type PortalNotificationItem,
} from "@/components/portal/portal-notifications-context";
import { formatMediaDate } from "@/lib/job-media-types";
import { useToast } from "@/hooks/use-toast";
import { useIsBelowLg } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { MobileBottomNav } from "@/components/portal/mobile-dashboard/MobileBottomNav";
import { openPortalNotification } from "@/lib/portal-notification-open";
import { useDoc, useMemoFirebase, useUser, useFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { resolveNotificationTarget } from "@/lib/notification-target";

type FilterKey =
  | "all"
  | "unread"
  | "job"
  | "message"
  | "finance"
  | "calendar"
  | "system";

const FILTER_CHIPS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Vše" },
  { key: "unread", label: "Nepřečtené" },
  { key: "job", label: "Zakázky" },
  { key: "message", label: "Zprávy" },
  { key: "finance", label: "Finance" },
  { key: "calendar", label: "Kalendář" },
  { key: "system", label: "Systém" },
];

function notificationIcon(item: PortalNotificationItem) {
  const t = (item.type ?? "").toUpperCase();
  if (t.includes("EMAIL")) return Mail;
  if (t.includes("CHAT") || item.category === "message") return MessageSquare;
  if (t.includes("MEETING") || t.includes("CALENDAR")) return Calendar;
  if (t.includes("INVOICE")) return Wallet;
  if (item.category === "job" || t.includes("JOB")) return Briefcase;
  return Bell;
}

function matchesFilter(item: PortalNotificationItem, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "unread") return !item.read;
  const t = (item.type ?? "").toUpperCase();
  const cat = item.category;
  if (filter === "job") return cat === "job" || t.includes("JOB") || t.includes("DOCUMENT");
  if (filter === "message") {
    return (
      cat === "message" ||
      t.includes("CHAT") ||
      t.includes("EMAIL") ||
      item.targetType === "chat" ||
      item.targetType === "email"
    );
  }
  if (filter === "finance") {
    return t.includes("INVOICE") || item.targetType === "invoice" || item.targetType === "document";
  }
  if (filter === "calendar") {
    return t.includes("MEETING") || item.targetType === "calendar-event";
  }
  if (filter === "system") {
    return cat === "system" || t === "SYSTEM_ALERT" || item.targetType === "announcement";
  }
  return true;
}

export default function PortalNotificationsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const belowLg = useIsBelowLg();
  const { user } = useUser();
  const { firestore } = useFirebase();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc(userRef);
  const role = String((profile as { role?: string } | undefined)?.role ?? "").trim();

  const [pushBusy, setPushBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [openingId, setOpeningId] = useState<string | null>(null);

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

  const filteredItems = useMemo(
    () => items.filter((row) => matchesFilter(row, filter)),
    [items, filter]
  );

  const needsPushRestore =
    pushSupported &&
    pushDiagnostics.permission === "granted" &&
    pushDiagnostics.vapidConfigured &&
    !pushDiagnostics.localDevicePushActive;

  const needsServerResync =
    pushSupported &&
    pushDiagnostics.permission === "granted" &&
    pushDiagnostics.localDevicePushActive &&
    !pushDiagnostics.serverRegisteredThisDevice;

  const pushActive =
    pushDiagnostics.permission === "granted" &&
    pushDiagnostics.vapidConfigured &&
    pushDiagnostics.localDevicePushActive &&
    pushDiagnostics.serverRegisteredThisDevice;

  const handleOpen = useCallback(
    async (row: PortalNotificationItem) => {
      if (openingId) return;
      setOpeningId(row.id);
      try {
        await openPortalNotification(row, {
          role: role || undefined,
          markAsRead,
          router,
        });
      } finally {
        setOpeningId(null);
      }
    },
    [markAsRead, openingId, role, router]
  );

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

  const onTestPush = async (scope: "current" | "all") => {
    setTestBusy(true);
    try {
      const r = await sendTestPush(scope);
      toast({
        title: r.ok ? "Test odeslán" : "Test selhal",
        description: r.message,
        variant: r.ok ? "default" : "destructive",
      });
    } finally {
      setTestBusy(false);
    }
  };

  const pushCard = (
    <Card className={belowLg ? "border-white/10 bg-slate-900/80 text-slate-50" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className={cn("text-base flex items-center gap-2", belowLg && "text-white")}>
          <Smartphone className="h-4 w-4" />
          Push na tomto zařízení
        </CardTitle>
        <CardDescription className={belowLg ? "text-slate-400" : undefined}>
          {pushSupported
            ? pushActive
              ? "Push oznámení: Aktivní na tomto zařízení i na serveru."
              : needsServerResync
                ? "Oprávnění je uděleno, ale server nemá subscription tohoto zařízení — obnovte push."
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
          <span className={cn("text-muted-foreground", belowLg && "text-slate-500")}>
            Zařízení: {pushDiagnostics.deviceLabel}
          </span>
        </div>
        {pushDiagnostics.activeDeviceCount > 0 ? (
          <p className={cn("text-muted-foreground", belowLg && "text-slate-400")}>
            Aktivní zařízení (server): {pushDiagnostics.activeDeviceCount}
          </p>
        ) : null}
        {pushDiagnostics.devices.length > 0 ? (
          <ul className={cn("space-y-1 text-xs", belowLg ? "text-slate-400" : "text-muted-foreground")}>
            {pushDiagnostics.devices.map((d) => (
              <li key={d.id}>
                {d.isCurrentDevice ? "● " : "○ "}
                {d.label}
                {d.isCurrentDevice ? " (toto zařízení)" : ""}
              </li>
            ))}
          </ul>
        ) : null}
        {pushDiagnostics.iosHomeScreenHint ? (
          <p className="text-amber-700 dark:text-amber-400 text-xs">
            iOS: přidejte Rajmondata na Domovskou obrazovku a povolte oznámení (iOS 16.4+).
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {pushSupported && (needsPushRestore || needsServerResync || !pushActive) ? (
            <Button type="button" size="sm" disabled={pushBusy} onClick={() => void onEnablePush()}>
              {pushBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {needsServerResync ? "Obnovit push oznámení" : "Povolit push"}
            </Button>
          ) : null}
          {pushSupported && pushDiagnostics.vapidConfigured ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={testBusy}
                onClick={() => void onTestPush("current")}
              >
                {testBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Send className="h-4 w-4 mr-1" />
                )}
                Poslat testovací oznámení
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={testBusy}
                onClick={() => void onTestPush("all")}
              >
                Poslat test na všechna moje zařízení
              </Button>
            </>
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
  );

  const renderListRow = (row: PortalNotificationItem, mobile: boolean) => {
    const Icon = notificationIcon(row);
    const resolved = resolveNotificationTarget(
      {
        id: row.id,
        type: row.type,
        category: row.category,
        entityType: row.entityType,
        entityId: row.entityId,
        linkUrl: row.linkUrl,
        targetType: row.targetType,
        targetId: row.targetId,
        targetUrl: row.targetUrl,
        jobId: row.jobId,
        messageId: row.messageId,
        commentId: row.commentId,
        conversationId: row.conversationId,
        documentId: row.documentId,
        invoiceId: row.invoiceId,
        inquiryId: row.inquiryId,
        calendarEventId: row.calendarEventId,
      },
      { role: role || undefined }
    );
    const hasTarget = !resolved.missing || Boolean(resolved.href);

    if (mobile) {
      return (
        <li key={row.id}>
          <button
            type="button"
            disabled={openingId === row.id}
            onClick={() => void handleOpen(row)}
            className={cn(
              "w-full rounded-xl border p-4 text-left transition-colors",
              "border-white/10 bg-slate-900/90 active:bg-slate-800/90",
              !row.read && "border-l-2 border-l-orange-500",
              row.read && "opacity-80"
            )}
          >
            <div className="flex gap-3">
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                  !row.read ? "bg-orange-500/15 text-orange-400" : "bg-white/5 text-slate-400"
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-sm text-white">{row.title}</p>
                  {!row.read ? (
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-orange-500" aria-hidden />
                  ) : null}
                </div>
                <p className="text-sm text-slate-400 whitespace-pre-wrap line-clamp-3">{row.body}</p>
                <p className="text-[11px] text-slate-500">
                  {formatMediaDate(row.createdAt)}
                </p>
                {hasTarget ? (
                  <span className="inline-flex items-center gap-0.5 pt-1 text-xs font-semibold text-orange-400">
                    Otevřít
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  </span>
                ) : null}
              </div>
            </div>
          </button>
        </li>
      );
    }

    return (
      <li key={row.id}>
        <div
          className={cn(
            "flex flex-col gap-1 p-3 text-left sm:flex-row sm:items-start sm:justify-between",
            !row.read ? "bg-primary/5" : ""
          )}
        >
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-sm">{row.title}</p>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.body}</p>
            <p className="text-[11px] text-muted-foreground">
              {formatMediaDate(row.createdAt)} · {row.category}
            </p>
          </div>
          <div className="flex shrink-0 gap-2 sm:flex-col sm:items-end">
            {hasTarget ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={openingId === row.id}
                onClick={() => void handleOpen(row)}
              >
                Otevřít
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
    );
  };

  return (
    <>
      {/* Desktop */}
      <div className="hidden lg:block mx-auto max-w-2xl space-y-6">
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

        {pushCard}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Seznam</CardTitle>
            <CardDescription>
              Důležité události podle vašich oprávnění a předvoleb v Nastavení.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap gap-2">
              {FILTER_CHIPS.map((chip) => (
                <Button
                  key={chip.key}
                  type="button"
                  size="sm"
                  variant={filter === chip.key ? "default" : "outline"}
                  onClick={() => setFilter(chip.key)}
                >
                  {chip.label}
                </Button>
              ))}
            </div>
            {isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Žádná oznámení.</p>
            ) : (
              <ul className="divide-y rounded-md border">{filteredItems.map((row) => renderListRow(row, false))}</ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mobile — tmavý RAJMONDATA styl */}
      <div
        className={cn(
          "lg:hidden",
          "-mx-3 -my-3 min-h-[100dvh] px-4 pb-[calc(96px+env(safe-area-inset-bottom))] pt-4 sm:-mx-4 sm:-my-4 sm:px-6 md:-mx-6 md:-my-6 md:px-8",
          "bg-[#050816] text-slate-50"
        )}
      >
        <div className="flex items-center justify-between gap-2 pb-4">
          <div>
            <h1 className="text-lg font-semibold text-white flex items-center gap-2">
              <Bell className="h-5 w-5 text-orange-400" aria-hidden />
              Oznámení
            </h1>
            <p className="text-xs text-slate-400">Nepřečtených: {unreadCount}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 border-white/15 bg-white/5 text-slate-100 hover:bg-white/10"
            disabled={!unreadCount}
            onClick={() => void markAllRead()}
          >
            <CheckCheck className="h-4 w-4 mr-1" aria-hidden />
            Vše přečíst
          </Button>
        </div>

        <div className="mb-4 -mx-1 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilter(chip.key)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                filter === chip.key
                  ? "border-orange-500/60 bg-orange-500/15 text-orange-300"
                  : "border-white/10 bg-slate-900/80 text-slate-300"
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="mb-4">{pushCard}</div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
          </div>
        ) : filteredItems.length === 0 ? (
          <p className="text-sm text-slate-500 py-10 text-center">Žádná oznámení.</p>
        ) : (
          <ul className="space-y-3">{filteredItems.map((row) => renderListRow(row, true))}</ul>
        )}
      </div>

      {belowLg ? <MobileBottomNav role={role || undefined} /> : null}
    </>
  );
}
