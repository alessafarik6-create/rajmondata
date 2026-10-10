"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useUser, useCompany } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ORG_CAMPAIGN_TYPE_LABELS, type OrgCampaignType } from "@/lib/platform-org-campaigns/types";

export default function PortalCampaignDetailPage() {
  const params = useParams();
  const campaignId = String(params.campaignId ?? "");
  const { user } = useUser();
  const { companyId } = useCompany();
  const router = useRouter();
  const { toast } = useToast();
  const [campaign, setCampaign] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user || !companyId || !campaignId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/platform-campaigns/${encodeURIComponent(campaignId)}?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          router.push(`/login?next=${encodeURIComponent(`/portal/campaigns/${campaignId}`)}`);
          return;
        }
        throw new Error(data.error ?? "Chyba");
      }
      setCampaign(data.campaign);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Zpráva",
        description: e instanceof Error ? e.message : "Nelze načíst.",
      });
    } finally {
      setLoading(false);
    }
  }, [user, companyId, campaignId, router, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function react(reaction: "interested" | "declined" | "support") {
    if (!user || !companyId || busy) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/platform-campaigns/${encodeURIComponent(campaignId)}/react`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ reaction }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Chyba");
      toast({
        title: reaction === "interested" ? "Děkujeme za zájem" : reaction === "declined" ? "Uloženo" : "Podpora",
        description:
          reaction === "support" && data.ticketId
            ? "Vytvořili jsme požadavek podpory."
            : undefined,
      });
      await load();
      if (reaction === "declined") router.push("/portal/dashboard");
    } catch (e) {
      toast({ variant: "destructive", title: "Chyba", description: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!campaign) {
    return (
      <p className="p-6 text-muted-foreground">
        Zpráva není k dispozici.{" "}
        <Link href="/portal/dashboard" className="text-orange-600 underline">
          Zpět na přehled
        </Link>
      </p>
    );
  }

  const type = campaign.type as OrgCampaignType | undefined;

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6 space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/portal/dashboard">← Přehled</Link>
      </Button>
      <Card>
        {campaign.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={String(campaign.imageUrl)}
            alt=""
            className="w-full max-h-64 object-cover rounded-t-lg"
          />
        ) : null}
        <CardHeader>
          <p className="text-xs text-muted-foreground">
            {type ? ORG_CAMPAIGN_TYPE_LABELS[type] : "RAJMONDATA"}
          </p>
          <CardTitle>{String(campaign.title ?? "")}</CardTitle>
          <p className="text-sm text-muted-foreground">{String(campaign.shortDescription ?? "")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: String(campaign.bodyHtml ?? "") }}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              disabled={busy}
              className="bg-orange-500 hover:bg-orange-600 text-black"
              onClick={() => void react("interested")}
            >
              Mám zájem
            </Button>
            <Button disabled={busy} variant="outline" onClick={() => void react("declined")}>
              Nemám zájem
            </Button>
            <Button disabled={busy} variant="secondary" onClick={() => void react("support")}>
              Napsat podpoře
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
