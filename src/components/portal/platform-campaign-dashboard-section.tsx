"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useUser, useCompany } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Megaphone } from "lucide-react";
import { ORG_CAMPAIGN_TYPE_LABELS, type OrgCampaignType } from "@/lib/platform-org-campaigns/types";

type CampaignRow = {
  id: string;
  title: string;
  shortDescription?: string;
  type?: OrgCampaignType;
  imageUrl?: string | null;
};

export function PlatformCampaignDashboardSection() {
  const { user } = useUser();
  const { companyId } = useCompany();
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user || !companyId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/platform-campaigns?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (data.ok) setRows(data.campaigns ?? []);
    } finally {
      setLoading(false);
    }
  }, [user, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!companyId || loading) return null;
  if (!rows.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Megaphone className="h-4 w-4 text-orange-500" />
        Zprávy a nabídky RAJMONDATA
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.slice(0, 6).map((c) => (
          <Card key={c.id} className="overflow-hidden border-orange-200/60 dark:border-orange-900/40">
            {c.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.imageUrl} alt="" className="h-28 w-full object-cover" />
            ) : null}
            <CardHeader className="pb-2 pt-3 px-4">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base leading-snug">{c.title}</CardTitle>
                {c.type ? (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {ORG_CAMPAIGN_TYPE_LABELS[c.type] ?? c.type}
                  </Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-3">
              <p className="text-sm text-muted-foreground line-clamp-2">{c.shortDescription}</p>
              <Button size="sm" className="w-full bg-orange-500 hover:bg-orange-600 text-black" asChild>
                <Link href={`/portal/campaigns/${encodeURIComponent(c.id)}`}>Zobrazit detail</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
