"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useFirestore } from "@/firebase";
import { useEmployeeNotificationsInbox } from "@/hooks/use-employee-notifications-inbox";
import { isFirestoreIndexError } from "@/firebase/firestore/firestore-query-errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMediaDate } from "@/lib/job-media-types";
import { cn } from "@/lib/utils";
import type { EmployeeNotificationType } from "@/lib/employee-notifications";

type EmployeeNotifRow = {
  id: string;
  title: string;
  message: string;
  type: EmployeeNotificationType;
  isRead: boolean;
  createdAt: unknown;
  linkUrl: string | null;
};

function typeLabel(t: EmployeeNotificationType): string {
  if (t === "important") return "Důležité";
  if (t === "training") return "Školení";
  if (t === "meeting") return "Porada";
  return "Info";
}

function typeBadgeVariant(
  t: EmployeeNotificationType
): "default" | "secondary" | "outline" {
  if (t === "important") return "default";
  if (t === "training" || t === "meeting") return "secondary";
  return "outline";
}

export function EmployeeNotificationsPanel(props: {
  companyId: string | undefined;
  employeeId: string | undefined;
  compact?: boolean;
}) {
  const { companyId, employeeId, compact } = props;
  const firestore = useFirestore();
  const [filter, setFilter] = useState<"all" | "unread" | "important">("all");

  const { sortedDocs, unreadCount, isLoading, error, isIndexPending } =
    useEmployeeNotificationsInbox({ companyId, employeeId });

  useEffect(() => {
    if (!companyId || !employeeId) return;
    console.log("[employee-notifications] snapshot", {
      companyId,
      employeeId,
      count: sortedDocs.length,
      isIndexPending,
      error: error?.message ?? null,
    });
  }, [companyId, employeeId, sortedDocs.length, isIndexPending, error]);

  const items = useMemo((): EmployeeNotifRow[] => {
    const list = Array.isArray(sortedDocs) ? sortedDocs : [];
    return list
      .map((r: any) => ({
        id: String(r?.id ?? ""),
        title: typeof r?.title === "string" ? r.title : "Upozornění",
        message: typeof r?.message === "string" ? r.message : "",
        type:
          r?.type === "important" ||
          r?.type === "training" ||
          r?.type === "meeting" ||
          r?.type === "info"
            ? (r.type as EmployeeNotificationType)
            : "info",
        isRead: r?.isRead === true,
        createdAt: r?.createdAt,
        linkUrl:
          typeof r?.linkUrl === "string" && r.linkUrl.trim()
            ? r.linkUrl.trim()
            : null,
      }))
      .filter((i) => Boolean(i.id));
  }, [sortedDocs]);

  const filtered = useMemo(() => {
    if (filter === "unread") return items.filter((i) => !i.isRead);
    if (filter === "important") return items.filter((i) => i.type === "important");
    return items;
  }, [items, filter]);

  const markRead = async (id: string) => {
    if (!firestore || !companyId) return;
    await updateDoc(
      doc(firestore, "companies", companyId, "employee_notifications", id),
      { isRead: true, readAt: serverTimestamp(), updatedAt: serverTimestamp() }
    );
  };

  return (
    <Card className={cn(compact && "border-slate-200")}>
      <CardHeader className={cn(compact ? "py-3" : "pb-2")}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className={cn("text-base", !compact && "text-lg")}>
            Upozornění
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Nepřečtené: <strong>{unreadCount}</strong>
          </p>
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="all">Vše</TabsTrigger>
            <TabsTrigger value="unread">Nepřečtené</TabsTrigger>
            <TabsTrigger value="important">Důležité</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className={cn(compact ? "pt-0" : "")}>
        {isIndexPending || (error != null && isFirestoreIndexError(error)) ? (
          <Alert className="border-amber-300 bg-amber-50 text-amber-950">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Upozornění se nepodařilo načíst</AlertTitle>
            <AlertDescription>
              Firestore hlásí chybějící nebo rozpracovaný index, nebo dočasnou chybu dotazu.
              Ověřte nasazení indexů (<code className="rounded bg-amber-100/80 px-1">firebase deploy --only firestore:indexes</code>)
              a zkuste stránku za chvíli znovu. Pokud problém přetrvá, kontaktujte administrátora.
            </AlertDescription>
          </Alert>
        ) : null}
        {error != null && !isFirestoreIndexError(error) ? (
          <Alert variant="destructive" className="mb-3">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Chyba</AlertTitle>
            <AlertDescription>
              {error.message || "Nelze načíst upozornění."}
            </AlertDescription>
          </Alert>
        ) : null}
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Načítání…</p>
        ) : error == null && !isIndexPending && filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Žádná upozornění.
          </p>
        ) : filtered.length > 0 ? (
          <ul className="divide-y rounded-md border">
            {filtered.map((n) => (
              <li key={n.id}>
                <div
                  className={cn(
                    "flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between",
                    !n.isRead && "bg-primary/5"
                  )}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-sm text-foreground">
                        {n.title}
                      </p>
                      <Badge variant={typeBadgeVariant(n.type)}>
                        {typeLabel(n.type)}
                      </Badge>
                      {!n.isRead ? (
                        <Badge variant="secondary">Nepřečtené</Badge>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {n.message}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatMediaDate(n.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2 sm:flex-col sm:items-end">
                    {n.linkUrl ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        asChild
                      >
                        <Link href={n.linkUrl} onClick={() => void markRead(n.id)}>
                          Otevřít
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        disabled={n.isRead}
                        onClick={() => void markRead(n.id)}
                      >
                        {n.isRead ? "Přečteno" : "Označit přečtené"}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

