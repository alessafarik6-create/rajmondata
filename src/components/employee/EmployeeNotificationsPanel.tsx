"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { useCollection, useMemoFirebase, useFirestore } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  const qRef = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "employee_notifications"),
      where("employeeId", "==", employeeId),
      orderBy("createdAt", "desc"),
      limit(50)
    );
  }, [firestore, companyId, employeeId]);

  const { data: raw = [], isLoading } = useCollection(qRef);

  const items = useMemo((): EmployeeNotifRow[] => {
    const list = Array.isArray(raw) ? raw : [];
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
  }, [raw]);

  const filtered = useMemo(() => {
    if (filter === "unread") return items.filter((i) => !i.isRead);
    if (filter === "important") return items.filter((i) => i.type === "important");
    return items;
  }, [items, filter]);

  const unreadCount = useMemo(
    () => items.filter((i) => !i.isRead).length,
    [items]
  );

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
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Načítání…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Žádná upozornění.
          </p>
        ) : (
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
        )}
      </CardContent>
    </Card>
  );
}

