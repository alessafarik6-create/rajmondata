"use client";

import React, { useCallback, useMemo, useState } from "react";
import { format } from "date-fns";
import { cs } from "date-fns/locale";
import { Loader2, Mail, Plus, Send } from "lucide-react";
import {
  collection,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import {
  useUser,
  useFirestore,
  useCollection,
  useMemoFirebase,
  useCompany,
  useDoc,
} from "@/firebase";
import { doc } from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  INQUIRY_OFFER_STANDALONE_LEAD_KEY,
  parseInquiryOfferTemplateDoc,
  type InquiryOfferRecord,
} from "@/lib/inquiry-offer-email";
import {
  StandaloneInquiryOfferDialog,
} from "@/components/leads/lead-inquiry-offer-dialog";
import { LeadInquiryOfferDetailDialog } from "@/components/leads/lead-inquiry-offer-detail-dialog";
import {
  formatInquiryOfferPrice,
  formatInquiryOfferPricingBlock,
  inquiryOfferHasFullDetail,
  inquiryOfferToReuseInitial,
  INQUIRY_OFFER_STATUS_LABELS,
} from "@/lib/inquiry-offer-history";
import { contactTimestampToDate } from "@/lib/lead-contact-status";
import type { InquiryOfferSentInfo } from "@/components/leads/inquiry-offer-composer";

function formatOfferDate(offer: InquiryOfferRecord): string {
  const d =
    contactTimestampToDate(offer.sentAt) ??
    contactTimestampToDate(offer.updatedAt) ??
    contactTimestampToDate(offer.createdAt);
  return d ? format(d, "d. M. yyyy HH:mm", { locale: cs }) : "—";
}

export default function StandaloneOffersPage() {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { companyName } = useCompany();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc(userRef);
  const companyId = profile?.companyId as string | undefined;
  const role = (profile?.role as string | undefined) ?? "employee";
  const isCustomer = role === "customer";
  const canManageOffers =
    role === "owner" || role === "admin" || role === "manager" || role === "accountant";

  const offerTemplatesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "inquiry_offer_templates");
  }, [firestore, companyId]);

  const inquiryOffersQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "inquiry_offers"),
      orderBy("updatedAt", "desc"),
      limit(400)
    );
  }, [firestore, companyId]);

  const { data: offerTemplatesRaw } = useCollection(offerTemplatesQuery);
  const { data: inquiryOffersRaw, isLoading } = useCollection(inquiryOffersQuery);

  const [composerOpen, setComposerOpen] = useState(false);
  const [reuseInitial, setReuseInitial] = useState<
    ReturnType<typeof inquiryOfferToReuseInitial> | undefined
  >(undefined);
  const [detailOffer, setDetailOffer] = useState<InquiryOfferRecord | null>(null);
  const [optimisticOffers, setOptimisticOffers] = useState<InquiryOfferRecord[]>([]);

  const offerTemplates = useMemo(() => {
    const list = Array.isArray(offerTemplatesRaw) ? offerTemplatesRaw : [];
    return list
      .map((d) => {
        const row = d as Record<string, unknown> & { id?: string };
        const id = String(row.id ?? "").trim();
        if (!id) return null;
        return parseInquiryOfferTemplateDoc(id, row);
      })
      .filter(Boolean) as ReturnType<typeof parseInquiryOfferTemplateDoc>[];
  }, [offerTemplatesRaw]);

  const standaloneOffers = useMemo(() => {
    const list = Array.isArray(inquiryOffersRaw) ? inquiryOffersRaw : [];
    const fromDb = list
      .map((d) => {
        const row = d as Record<string, unknown> & { id?: string };
        return { ...row, id: row.id } as InquiryOfferRecord;
      })
      .filter(
        (o) =>
          o.isStandalone === true ||
          o.leadKey === INQUIRY_OFFER_STANDALONE_LEAD_KEY
      );
    const byId = new Map<string, InquiryOfferRecord>();
    for (const o of fromDb) {
      if (o.id) byId.set(o.id, o);
    }
    for (const o of optimisticOffers) {
      if (o.id) byId.set(o.id, o);
    }
    return [...byId.values()].sort((a, b) => {
      const ta =
        contactTimestampToDate(a.sentAt)?.getTime() ??
        contactTimestampToDate(a.updatedAt)?.getTime() ??
        0;
      const tb =
        contactTimestampToDate(b.sentAt)?.getTime() ??
        contactTimestampToDate(b.updatedAt)?.getTime() ??
        0;
      return tb - ta;
    });
  }, [inquiryOffersRaw, optimisticOffers]);

  const handleSent = useCallback(
    (info: InquiryOfferSentInfo) => {
      if (!companyId || !info.offerId) return;
      setOptimisticOffers((prev) => [
        {
          id: info.offerId,
          companyId,
          leadKey: INQUIRY_OFFER_STANDALONE_LEAD_KEY,
          status: "sent",
          to: info.to,
          subject: info.subject,
          bodyPlain: info.bodyText,
          bodyHtml: "",
          priceNet: info.priceNet,
          vatRate: info.vatRate,
          vatAmount: info.vatAmount,
          priceGross: info.priceGross,
          attachments: info.attachments,
          isStandalone: true,
          customerName: null,
          internalNote: info.internalNote,
          templateId: info.templateId,
          templateName: info.templateName,
          sentAt: new Date(),
        },
        ...prev.filter((o) => o.id !== info.offerId),
      ]);
      setReuseInitial(undefined);
    },
    [companyId]
  );

  if (isUserLoading || profileLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isCustomer) {
    return (
      <Alert className="max-w-lg border-slate-200">
        <AlertTitle>Přístup omezen</AlertTitle>
        <AlertDescription>Sekce nabídek není pro účet zákazníka k dispozici.</AlertDescription>
      </Alert>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-xl border-slate-200 bg-slate-50">
        <AlertTitle>Není vybraná firma</AlertTitle>
        <AlertDescription>Nabídky nelze načíst bez přiřazení k organizaci.</AlertDescription>
      </Alert>
    );
  }

  if (!canManageOffers) {
    return (
      <Alert className="max-w-lg border-slate-200">
        <AlertTitle>Přístup omezen</AlertTitle>
        <AlertDescription>Nemáte oprávnění spravovat nabídky.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="portal-page-title text-2xl sm:text-3xl flex items-center gap-2">
            <Send className="h-7 w-7 text-orange-700 shrink-0" />
            Nabídky
          </h1>
          <p className="portal-page-description mt-1">
            E-mailové nabídky odeslané bez vazby na poptávku. Historie včetně cen, DPH a příloh.
          </p>
        </div>
        <Button
          type="button"
          className="min-h-11 gap-2 bg-orange-600 hover:bg-orange-700 shrink-0"
          onClick={() => {
            setReuseInitial(undefined);
            setComposerOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Nová nabídka
        </Button>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Historie samostatných nabídek</CardTitle>
          <CardDescription>
            Odeslané i uložené koncepty. Klepnutím zobrazíte celý obsah nabídky.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Načítám…
            </p>
          ) : standaloneOffers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádná samostatná nabídka.</p>
          ) : (
            <ul className="space-y-2">
              {standaloneOffers.map((o) => {
                const dateLabel = formatOfferDate(o);
                const statusLabel = INQUIRY_OFFER_STATUS_LABELS[o.status] ?? o.status;
                const recipient = o.customerName
                  ? `${o.customerName} · ${o.to}`
                  : o.to || "—";
                const price =
                  o.priceNet != null || o.priceGross != null
                    ? formatInquiryOfferPricingBlock(o)
                    : formatInquiryOfferPrice(o.priceGross);
                const attachCount = Array.isArray(o.attachments) ? o.attachments.length : 0;

                return (
                  <li
                    key={o.id ?? `${o.subject}-${dateLabel}`}
                    className="rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-xs tabular-nums text-slate-500">{dateLabel}</span>
                          <span
                            className={
                              o.status === "sent"
                                ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-900"
                                : "rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700"
                            }
                          >
                            {statusLabel}
                          </span>
                        </div>
                        <p className="font-medium text-slate-900 truncate">{o.subject || "—"}</p>
                        <p className="text-xs text-slate-600 truncate">{recipient}</p>
                        <p className="text-xs text-slate-600">{price}</p>
                        {attachCount > 0 ? (
                          <p className="text-xs text-slate-500">
                            {attachCount} příloh{attachCount === 1 ? "a" : attachCount < 5 ? "y" : ""}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 min-h-10"
                        onClick={() => setDetailOffer(o)}
                      >
                        <Mail className="h-3.5 w-3.5 mr-1" />
                        Zobrazit nabídku
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <StandaloneInquiryOfferDialog
        open={composerOpen}
        onOpenChange={(o) => {
          setComposerOpen(o);
          if (!o) setReuseInitial(undefined);
        }}
        companyId={companyId}
        companyName={companyName || "Organizace"}
        templates={offerTemplates}
        initial={reuseInitial}
        onSent={handleSent}
      />

      <LeadInquiryOfferDetailDialog
        offer={detailOffer}
        open={!!detailOffer}
        onOpenChange={(o) => {
          if (!o) setDetailOffer(null);
        }}
        canResend={canManageOffers}
        onReuse={(offer) => {
          setReuseInitial(inquiryOfferToReuseInitial(offer));
          setComposerOpen(true);
        }}
        onResend={(offer) => {
          setReuseInitial(inquiryOfferToReuseInitial(offer));
          setComposerOpen(true);
        }}
      />
    </div>
  );
}
