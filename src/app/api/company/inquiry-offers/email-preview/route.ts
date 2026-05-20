import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  buildInquiryOfferEmailHtml,
  plainTextToHtmlParagraphs,
  readInquiryEmailIdentity,
} from "@/lib/inquiry-offer-email";
import {
  buildInquiryOfferSentBodyPlain,
  calculateInquiryOfferPricing,
  formatInquiryPriceCz,
  normalizeInquiryVatRate,
  parseInquiryPriceInput,
} from "@/lib/inquiry-offer-pricing";
import { resolveInquiryOfferAuthor } from "@/lib/inquiry-offer-author-resolve";
import { buildInquiryOfferFooterData } from "@/lib/inquiry-offer-footer";
import { parseAttachmentRefs } from "@/lib/inquiry-offer-attachments";
import { formatInquiryOfferAttachmentLine } from "@/lib/inquiry-offer-history";
import {
  buildInquiryOfferSendPlan,
  INQUIRY_OFFER_SEND_METHOD_LABELS,
} from "@/lib/inquiry-offer-send-plan";
import {
  formatOfferCopyEmailsForDisplay,
  INQUIRY_OFFER_COPY_MODE_LABELS,
  resolveInquiryOfferCopyDelivery,
  validateOfferCopyEmailsRaw,
} from "@/lib/inquiry-offer-copy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  companyId?: string;
  to?: string;
  subject?: string;
  bodyText?: string;
  priceNet?: number | null;
  vatRate?: number | null;
  attachments?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const db = getAdminFirestore();
    const auth = getAdminAuth();
    if (!db || !auth) {
      return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
    }

    const authHeader = request.headers.get("authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
    if (!caller) {
      return NextResponse.json({ ok: false, error: "Neautorizováno." }, { status: 401 });
    }
    if (caller.role === "customer") {
      return NextResponse.json({ ok: false, error: "Zákazník nemá přístup." }, { status: 403 });
    }

    const body = (await request.json()) as Body;
    const companyId = String(body.companyId ?? "").trim();
    if (!companyId) {
      return NextResponse.json({ ok: false, error: "Chybí companyId." }, { status: 400 });
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const snap = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "Organizace nenalezena." }, { status: 404 });
    }
    const company = (snap.data() ?? {}) as Record<string, unknown>;
    const identity = readInquiryEmailIdentity(company);
    const planResult = await buildInquiryOfferSendPlan({ company, identity });
    if ("error" in planResult) {
      return NextResponse.json({ ok: false, error: planResult.error }, { status: 400 });
    }

    const author = await resolveInquiryOfferAuthor({
      db,
      auth,
      companyId,
      userId: caller.uid,
    });
    const footer = buildInquiryOfferFooterData({ company, identity, author });

    const userBodyPlain = String(body.bodyText ?? "").trim();
    const pricing = calculateInquiryOfferPricing(
      parseInquiryPriceInput(body.priceNet),
      normalizeInquiryVatRate(body.vatRate)
    );
    const bodyPlain = userBodyPlain
      ? buildInquiryOfferSentBodyPlain(userBodyPlain, pricing)
      : "";
    const bodyInnerHtml = bodyPlain ? plainTextToHtmlParagraphs(bodyPlain) : "";
    const html = bodyPlain
      ? buildInquiryOfferEmailHtml({
          bodyHtmlContent: bodyInnerHtml,
          organizationName: planResult.fromDisplayName,
          footer,
        })
      : "";

    const attachmentRefs = parseAttachmentRefs(body.attachments);
    const toNorm = String(body.to ?? "").trim().toLowerCase();

    let copyLabel: string | null = null;
    const copyValidation = validateOfferCopyEmailsRaw(identity.offerCopyEmails);
    if (copyValidation.ok && toNorm) {
      try {
        const delivery = resolveInquiryOfferCopyDelivery(identity, toNorm);
        if (delivery?.emails.length) {
          copyLabel = `${formatOfferCopyEmailsForDisplay(delivery.emails)} (${INQUIRY_OFFER_COPY_MODE_LABELS[delivery.mode]})`;
        }
      } catch {
        copyLabel = null;
      }
    }

    return NextResponse.json({
      ok: true,
      preview: {
        to: String(body.to ?? "").trim(),
        subject: String(body.subject ?? "").trim(),
        bodyPlain,
        bodyHtml: html,
        footer,
        pricing: {
          priceNet: pricing.priceNet,
          vatRate: pricing.vatRate,
          vatAmount: pricing.vatAmount,
          priceGross: pricing.priceGross,
          priceNetLabel: formatInquiryPriceCz(pricing.priceNet),
          vatAmountLabel: formatInquiryPriceCz(pricing.vatAmount),
          priceGrossLabel: formatInquiryPriceCz(pricing.priceGross),
        },
        attachments: attachmentRefs.map((a) => ({
          ...a,
          line: formatInquiryOfferAttachmentLine(a),
        })),
        fromHeader: planResult.fromHeader,
        replyTo: planResult.replyTo,
        methodLabel: INQUIRY_OFFER_SEND_METHOD_LABELS[planResult.method],
        sendNotice: planResult.sendNotice,
        copyLabel,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Chyba náhledu." },
      { status: 500 }
    );
  }
}
