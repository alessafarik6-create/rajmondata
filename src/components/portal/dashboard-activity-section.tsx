"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMessageDateFromValue, MESSAGE_DATE_UNKNOWN, safeTime } from "@/lib/date-safe";
import {
  customerActivityVisualAge,
  formatCustomerActivityDateTime,
} from "@/lib/customer-activity";
import { resolveCustomerActivityOpenLink } from "@/lib/job-document-activity-link";

export type DashboardActivityRow = {
  id: string;
  title?: string;
  message?: string;
  createdAt?: unknown;
  timestamp?: unknown;
  sentAt?: unknown;
  updatedAt?: unknown;
  targetLink?: string;
  resolved?: boolean;
  organizationId?: string;
  jobId?: string;
  customerId?: string | null;
  documentId?: string | null;
  folderId?: string | null;
  documentType?: string | null;
  commentId?: string | null;
  fileName?: string | null;
  type?: string;
  targetId?: string;
};

function resolveActivityAtMs(row: DashboardActivityRow): number {
  for (const key of ["createdAt", "timestamp", "sentAt", "updatedAt"] as const) {
    const ms = safeTime(row[key]);
    if (ms > 0) return ms;
  }
  return 0;
}

export function formatDashboardActivityTime(
  row: DashboardActivityRow | unknown
): string {
  if (row && typeof row === "object" && "id" in (row as object)) {
    return formatCustomerActivityDateTime(row as Record<string, unknown>);
  }
  const formatted = formatMessageDateFromValue(row);
  return formatted === MESSAGE_DATE_UNKNOWN ? MESSAGE_DATE_UNKNOWN : formatted;
}

function activityRowClassName(
  row: DashboardActivityRow,
  highlightCustomerAge?: boolean
): string {
  if (!highlightCustomerAge) {
    return "flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3";
  }
  const age = customerActivityVisualAge(row as Record<string, unknown>);
  return cn(
    "flex flex-col gap-2 border-l-4 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3",
    age === "fresh" && "border-l-green-500 bg-green-50/70",
    age === "stale" && "border-l-red-500 bg-red-50/70",
    age === "resolved" && "border-l-transparent bg-muted/40"
  );
}

type Props = {
  title: string;
  description?: string;
  items: DashboardActivityRow[];
  expanded: boolean;
  onToggleExpand: () => void;
  onMarkResolved: (id: string) => void;
  resolvingId?: string | null;
  badgeCount?: number;
  highlightBorder?: boolean;
  /** Barevné zvýraznění stáří (jen aktivita zákazníků). */
  highlightCustomerAge?: boolean;
};

export function DashboardActivitySection({
  title,
  description,
  items,
  expanded,
  onToggleExpand,
  onMarkResolved,
  resolvingId,
  badgeCount,
  highlightBorder,
  highlightCustomerAge,
}: Props) {
  const visible = expanded ? items : items.slice(0, 6);
  const canExpand = items.length > 6;

  return (
    <Card className={cn(highlightBorder && (badgeCount ?? 0) > 0 ? "border-red-300" : undefined)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {title}
          {(badgeCount ?? 0) > 0 ? (
            <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs text-white">
              {badgeCount}
            </span>
          ) : null}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žádná nová aktivita</p>
        ) : (
          <>
            <ul className="divide-y rounded-md border bg-card overflow-hidden">
              {visible.map((a) => {
                const age = highlightCustomerAge
                  ? customerActivityVisualAge(a as Record<string, unknown>)
                  : null;
                const dateLabel = formatDashboardActivityTime(a);
                const openHref = resolveCustomerActivityOpenLink(
                  a as Record<string, unknown>
                );
                return (
                  <li key={a.id} className={activityRowClassName(a, highlightCustomerAge)}>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium leading-snug">
                        {a.title?.trim() || "Aktivita"}
                      </p>
                      {a.message?.trim() ? (
                        <p className="text-xs text-muted-foreground leading-snug">{a.message}</p>
                      ) : null}
                      <p
                        className={cn(
                          "text-xs font-medium tabular-nums",
                          dateLabel === MESSAGE_DATE_UNKNOWN
                            ? "text-muted-foreground italic"
                            : "text-foreground/80"
                        )}
                      >
                        {dateLabel}
                      </p>
                      {highlightCustomerAge && age === "fresh" ? (
                        <p className="text-[10px] font-medium text-green-700">Nová aktivita</p>
                      ) : null}
                      {highlightCustomerAge && age === "stale" ? (
                        <p className="text-[10px] font-medium text-red-700">Čeká na vyřízení</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                      {openHref ? (
                        <Link href={openHref}>
                          <Button size="sm" variant="outline" className="h-8">
                            Otevřít
                          </Button>
                        </Link>
                      ) : null}
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-8"
                        disabled={resolvingId === a.id}
                        onClick={() => onMarkResolved(a.id)}
                      >
                        {resolvingId === a.id ? "…" : "Vyřízeno"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {canExpand ? (
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onToggleExpand}>
                {expanded ? "Zobrazit méně" : "Zobrazit aktivitu"}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Pro testy a řazení mimo komponentu. */
export { resolveActivityAtMs };
