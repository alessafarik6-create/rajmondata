import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import {
  absoluteUrl,
  buildCustomerAccessEmailHtml,
  loadCompanyEmailBranding,
  normalizeEmail,
  isValidEmail,
  toAppPasswordResetUrl,
} from "@/lib/customer-portal-email";
import { sendTransactionalEmail } from "@/lib/email-notifications/resend-send";
import { PLATFORM_NAME } from "@/lib/platform-brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ customerId: string }> }
) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ error: "Server není nakonfigurován." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller || !["owner", "admin"].includes(String(caller.role || ""))) {
    return NextResponse.json({ error: "Nemáte oprávnění." }, { status: 403 });
  }
  const companyId = caller.companyId;
  if (!callerCanAccessCompany(caller, companyId)) {
    return NextResponse.json({ error: "Nemáte přístup k organizaci." }, { status: 403 });
  }

  const { customerId } = await context.params;
  if (!customerId?.trim()) {
    return NextResponse.json({ error: "Chybí customerId." }, { status: 400 });
  }

  const customerRef = db
    .collection("companies")
    .doc(companyId)
    .collection("customers")
    .doc(customerId);
  const customerSnap = await customerRef.get();
  if (!customerSnap.exists) {
    return NextResponse.json({ error: "Zákazník nebyl nalezen." }, { status: 404 });
  }
  const customer = (customerSnap.data() ?? {}) as Record<string, unknown>;
  const portalUid = String(customer.customerPortalUid ?? "").trim();
  if (!portalUid) {
    return NextResponse.json(
      { error: "Pro zákazníka ještě neexistuje přístup do portálu." },
      { status: 400 }
    );
  }

  const email = normalizeEmail(customer.customerPortalEmail ?? customer.email);
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Zákazník nemá vyplněný e-mail" }, { status: 400 });
  }

  let resetLink: string;
  try {
    const firebaseResetLink = await auth.generatePasswordResetLink(email);
    resetLink = toAppPasswordResetUrl(firebaseResetLink);
  } catch {
    return NextResponse.json(
      { error: "Nepodařilo se připravit odkaz pro nastavení hesla." },
      { status: 500 }
    );
  }

  const branding = await loadCompanyEmailBranding(db, companyId);
  const loginUrl = absoluteUrl("/login");
  const customerName =
    String(customer.name ?? "").trim() ||
    String(customer.fullName ?? "").trim() ||
    String(customer.contactName ?? "").trim() ||
    "zákazníku";
  const subject = `${PLATFORM_NAME}: přístup do zákaznického portálu`;
  const html = buildCustomerAccessEmailHtml({
    portalName: PLATFORM_NAME,
    organizationName: branding.companyName,
    customerName,
    customerEmail: email,
    inviteUrl: resetLink,
    loginUrl,
    logoUrl: branding.logoUrl,
    contactEmail: branding.contactEmail,
  });

  const sent = await sendTransactionalEmail({
    to: [email],
    subject,
    html,
  });
  if (!sent.ok) {
    return NextResponse.json(
      { error: sent.error || "Nepodařilo se odeslat e-mail.", detail: sent.detail ?? null },
      { status: 502 }
    );
  }

  await customerRef.set(
    {
      customerAccessEmailSent: true,
      customerAccessEmailSentAt: FieldValue.serverTimestamp(),
      customerPortalEmail: email,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true, resetLink });
}
