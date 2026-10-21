"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Row = { day: string; counts: Record<string, number> };

export function AdminProductTourAnalytics() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/superadmin/product-tour/analytics", {
          credentials: "include",
          cache: "no-store",
        });
        const json = await res.json();
        if (json.ok) setRows(json.days ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totals = rows.reduce<Record<string, number>>((acc, r) => {
    for (const [k, v] of Object.entries(r.counts ?? {})) {
      acc[k] = (acc[k] ?? 0) + (typeof v === "number" ? v : 0);
    }
    return acc;
  }, {});

  const keys = Object.keys(totals).sort();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">AI prohlídka (/prohlídka) — agregace</CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-3">
        {loading ? <p className="text-muted-foreground">Načítám…</p> : null}
        {!loading && keys.length === 0 ? (
          <p className="text-muted-foreground">Zatím žádná data (posledních 30 dní).</p>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-2">
            {keys.map((k) => (
              <li key={k} className="flex justify-between border rounded-md px-3 py-2">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-semibold tabular-nums">{totals[k]}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Počty z denní agregace — bez ukládání hlasových nahrávek. Porovnání s registracemi řešíte v analytice webu.
        </p>
      </CardContent>
    </Card>
  );
}
