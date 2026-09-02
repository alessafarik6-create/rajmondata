"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { cs } from "date-fns/locale";
import {
  collection,
  query,
  orderBy,
  limit,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useFirestore, useCollection, useMemoFirebase, useUser } from "@/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { AI_QUOTE_EXAMPLES_COLLECTION, type AiQuoteExampleDoc } from "@/lib/ai/ai-center-types";
import type { InquiryOfferRecord } from "@/lib/inquiry-offer-email";
import {
  formatInquiryOfferPricingBlock,
  INQUIRY_OFFER_STATUS_LABELS,
} from "@/lib/inquiry-offer-history";
import { contactTimestampToDate } from "@/lib/lead-contact-status";
import { LeadInquiryOfferDetailDialog } from "@/components/leads/lead-inquiry-offer-detail-dialog";
import { parseFetchJsonResponse, extractApiError } from "@/lib/api/parse-fetch-response";

type Props = { companyId: string };

type ExampleFilter = "all" | "ai_on" | "ai_off" | "sent" | "won";

function parseCustomerFromSubject(subject: string): string | null {
  const m = subject.match(/Nabídka\s*[–-]\s*(.+)$/i);
  return m?.[1]?.trim() || null;
}

function formatOfferDate(offer: InquiryOfferRecord): string {
  const d =
    contactTimestampToDate(offer.sentAt) ??
    contactTimestampToDate(offer.updatedAt) ??
    contactTimestampToDate(offer.createdAt);
  return d ? format(d, "d.M.yyyy", { locale: cs }) : "—";
}

function offerDisplayNumber(offer: InquiryOfferRecord): string {
  const num = String((offer as Record<string, unknown>).offerNumber ?? "").trim();
  if (num) return num;
  if (offer.id) return `NAB-${offer.id.slice(0, 8).toUpperCase()}`;
  return "NAB-???";
}

function offerQualityLabel(offer: InquiryOfferRecord): string {
  if (offer.status === "sent") return "Odeslaná";
  if ((offer as Record<string, unknown>).wonJobId) return "Vyhraná zakázka";
  if (offer.status === "draft") return "Koncept";
  return INQUIRY_OFFER_STATUS_LABELS[offer.status] ?? offer.status;
}

export function AiCenterExamplesTab({ companyId }: Props) {
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  const examplesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, COMPANIES_COLLECTION, companyId, AI_QUOTE_EXAMPLES_COLLECTION);
  }, [firestore, companyId]);
  const { data: examplesRaw } = useCollection(examplesQuery);

  const offersQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, COMPANIES_COLLECTION, companyId, "inquiry_offers"),
      orderBy("updatedAt", "desc"),
      limit(200)
    );
  }, [firestore, companyId]);
  const { data: offersRaw, isLoading } = useCollection(offersQuery);

  const offers = useMemo(() => {
    return (offersRaw ?? []).map((d) => {
      const row = d as Record<string, unknown> & { id: string };
      return { ...row, id: row.id } as InquiryOfferRecord;
    });
  }, [offersRaw]);

  const inquiryTypes = useMemo(() => {
    const set = new Set<string>();
    for (const o of offers) {
      const t = String(o.inquiryType ?? "").trim();
      if (t) set.add(t);
    }
    return [...set].sort();
  }, [offers]);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ExampleFilter>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [detailOffer, setDetailOffer] = useState<InquiryOfferRecord | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState<Partial<AiQuoteExampleDoc>>({
    inquiryType: "",
    title: "",
    dimensionsText: "",
    bodyText: "",
    itemsSummary: "",
    referencePriceNet: null,
    active: true,
    source: "manual",
  });

  const filteredOffers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return offers.filter((o) => {
      const useAi = (o as Record<string, unknown>).useForAiExample === true;
      if (filter === "ai_on" && !useAi) return false;
      if (filter === "ai_off" && useAi) return false;
      if (filter === "sent" && o.status !== "sent") return false;
      if (filter === "won" && !(o as Record<string, unknown>).wonJobId) return false;
      if (typeFilter !== "all") {
        const t = String(o.inquiryType ?? "").trim();
        if (t !== typeFilter) return false;
      }
      if (!q) return true;
      const hay = [
        offerDisplayNumber(o),
        o.subject,
        o.inquiryType,
        o.customerName,
        parseCustomerFromSubject(o.subject),
        o.bodyPlain?.slice(0, 200),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [offers, search, filter, typeFilter]);

  const setOfferExample = async (offerId: string, useForAiExample: boolean, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/ai/offers/set-example", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, offerId, useForAiExample }),
      });
      const parsed = await parseFetchJsonResponse<{ ok?: boolean; error?: string; message?: string }>(res);
      if (!parsed.ok) throw new Error(parsed.error);
      const apiErr = extractApiError(parsed.data as Record<string, unknown>);
      if (!parsed.data?.ok) throw new Error(apiErr ?? "Uložení selhalo");
      toast({
        title: useForAiExample ? "Nabídka označena jako AI vzor." : "AI vzor odebrán.",
      });
    } catch (err) {
      toast({
        title: "Nepodařilo se uložit.",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const openDetail = (offer: InquiryOfferRecord) => {
    setDetailOffer(offer);
    setDetailOpen(true);
  };

  const saveManual = async () => {
    if (!firestore || !user || !manual.title?.trim()) return;
    await addDoc(collection(firestore, COMPANIES_COLLECTION, companyId, AI_QUOTE_EXAMPLES_COLLECTION), {
      companyId,
      source: "manual",
      inquiryType: manual.inquiryType?.trim() || "Obecná poptávka",
      title: manual.title.trim(),
      dimensionsText: manual.dimensionsText?.trim() || null,
      bodyText: manual.bodyText?.trim() || null,
      itemsSummary: manual.itemsSummary?.trim() || null,
      referencePriceNet: manual.referencePriceNet ?? null,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
    });
    toast({ title: "Příklad uložen." });
    setManualOpen(false);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row justify-between gap-4">
          <div>
            <CardTitle>Příklady nabídek</CardTitle>
            <CardDescription>
              Historické ceny nejsou autoritativní — slouží jako vzor struktury a textu. Aktuální cenu počítá CRM.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setManualOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Ruční příklad
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-1">
              <Label>Vyhledat</Label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Zákazník, typ, číslo…"
              />
            </div>
            <div>
              <Label>Filtr</Label>
              <Select value={filter} onValueChange={(v) => setFilter(v as ExampleFilter)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Všechny</SelectItem>
                  <SelectItem value="ai_on">Používané pro AI</SelectItem>
                  <SelectItem value="ai_off">Nepoužívané pro AI</SelectItem>
                  <SelectItem value="sent">Odeslané</SelectItem>
                  <SelectItem value="won">Vyhrané</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Typ poptávky</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Všechny typy</SelectItem>
                  {inquiryTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : filteredOffers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné nabídky neodpovídají filtru.</p>
          ) : (
            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {filteredOffers.map((offer) => {
                const useForAi = (offer as Record<string, unknown>).useForAiExample === true;
                const customer =
                  offer.customerName?.trim() ||
                  parseCustomerFromSubject(offer.subject ?? "") ||
                  "—";
                const price = formatInquiryOfferPricingBlock(offer);
                const headline =
                  String(offer.inquiryType ?? "").trim() ||
                  offer.subject?.replace(/^Nabídka\s*[–-]\s*/i, "").trim() ||
                  "Obecná nabídka";

                return (
                  <div
                    key={offer.id}
                    role="button"
                    tabIndex={0}
                    className="border rounded-lg p-3 text-sm hover:bg-muted/40 cursor-pointer transition-colors"
                    onClick={() => openDetail(offer)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") openDetail(offer);
                    }}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {offerDisplayNumber(offer)}
                          </span>
                          {useForAi ? (
                            <Badge variant="secondary" className="text-xs">AI vzor</Badge>
                          ) : null}
                          <Badge variant="outline" className="text-xs">
                            {offerQualityLabel(offer)}
                          </Badge>
                        </div>
                        <p className="font-medium truncate">{headline}</p>
                        <p className="text-muted-foreground truncate">{customer}</p>
                        <p className="text-xs text-muted-foreground">
                          {price} · {formatOfferDate(offer)}
                        </p>
                      </div>
                      <div
                        className="flex items-center gap-2 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-xs text-muted-foreground whitespace-nowrap">Používat pro AI</span>
                        <Switch
                          checked={useForAi}
                          onCheckedChange={(v) => void setOfferExample(offer.id!, v)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {(examplesRaw ?? []).length > 0 && (
            <div className="pt-2 border-t">
              <h3 className="text-sm font-medium mb-2">Ruční příklady</h3>
              {(examplesRaw ?? []).map((ex) => {
                const e = ex as AiQuoteExampleDoc;
                return (
                  <div key={e.id} className="border rounded p-2 mb-1 text-sm">
                    <p className="font-medium">{e.title}</p>
                    <p className="text-xs text-muted-foreground">{e.inquiryType}</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <LeadInquiryOfferDetailDialog
        offer={detailOffer}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        extraContent={
          detailOffer ? (
            <AiOfferExampleDetailExtras
              offer={detailOffer}
              onToggleUseForAi={(enabled) => {
                void setOfferExample(detailOffer.id!, enabled);
                setDetailOffer({ ...detailOffer, useForAiExample: enabled } as InquiryOfferRecord);
              }}
            />
          ) : null
        }
      />

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ruční příklad nabídky</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div><Label>Typ poptávky</Label><Input value={manual.inquiryType ?? ""} onChange={(e) => setManual({ ...manual, inquiryType: e.target.value })} /></div>
            <div><Label>Název</Label><Input value={manual.title ?? ""} onChange={(e) => setManual({ ...manual, title: e.target.value })} /></div>
            <div><Label>Rozměr</Label><Input value={manual.dimensionsText ?? ""} onChange={(e) => setManual({ ...manual, dimensionsText: e.target.value })} placeholder="5000 × 3000 mm" /></div>
            <div><Label>Text nabídky</Label><Textarea rows={4} value={manual.bodyText ?? ""} onChange={(e) => setManual({ ...manual, bodyText: e.target.value })} /></div>
            <div><Label>Položky</Label><Textarea rows={2} value={manual.itemsSummary ?? ""} onChange={(e) => setManual({ ...manual, itemsSummary: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={() => void saveManual()}>Uložit</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AiOfferExampleDetailExtras({
  offer,
  onToggleUseForAi,
}: {
  offer: InquiryOfferRecord;
  onToggleUseForAi: (enabled: boolean) => void;
}) {
  const useForAi = (offer as Record<string, unknown>).useForAiExample === true;
  const leadKey = String(offer.leadKey ?? "").trim();

  return (
    <div className="mt-4 rounded-lg border bg-muted/20 p-3 space-y-3 text-sm">
      <p className="font-medium">AI metadata</p>
      <div className="flex items-center justify-between gap-2">
        <span>Používat jako vzor pro AI</span>
        <Switch checked={useForAi} onCheckedChange={onToggleUseForAi} />
      </div>
      <p className="text-xs text-muted-foreground">
        Relevantní pro typ: {offer.inquiryType?.trim() || "—"}
      </p>
      <p className="text-xs text-muted-foreground">Kvalita vzoru: {offerQualityLabel(offer)}</p>
      <p className="text-xs text-amber-700 dark:text-amber-400">
        Historická cena — nepoužívá se jako aktuální ceník. Aktuální cenu určuje cenový engine CRM.
      </p>
      {leadKey && leadKey !== "__standalone__" ? (
        <Button variant="outline" size="sm" asChild>
          <Link href={`/portal/leads?highlight=${encodeURIComponent(leadKey)}`}>
            <ExternalLink className="h-3 w-3 mr-1" /> Původní poptávka
          </Link>
        </Button>
      ) : null}
      <Button variant="outline" size="sm" asChild>
        <Link href="/portal/offers">
          <ExternalLink className="h-3 w-3 mr-1" /> Otevřít v seznamu nabídek
        </Link>
      </Button>
    </div>
  );
}
