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
import { formatDateSafe } from "@/lib/date-safe";

export type DashboardActivityRow = {
  id: string;
  title?: string;
  message?: string;
  createdAt?: unknown;
  targetLink?: string;
};

export function formatDashboardActivityTime(raw: unknown): string {
  const s = formatDateSafe(raw);
  return s === "bez data" ? "—" : s;
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
            <ul className="divide-y rounded-md border bg-card">
              {visible.map((a) => (
                <li key={a.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-medium leading-snug">
                      {a.title?.trim() || "Aktivita"}
                    </p>
                    {a.message?.trim() ? (
                      <p className="text-xs text-muted-foreground leading-snug">{a.message}</p>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground">
                      {formatDashboardActivityTime(a.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                    {a.targetLink ? (
                      <Link href={a.targetLink}>
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
              ))}
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
