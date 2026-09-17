import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  COMPANIES_COLLECTION,
  COMPANY_LICENSES_COLLECTION,
  PLATFORM_ADMIN_NOTIFICATIONS_COLLECTION,
  USERS_COLLECTION,
} from "@/lib/firestore-collections";
import { buildNotificationHtml, sendTransactionalEmail } from "@/lib/email-notifications/resend-send";
import { loadPlatformProviderContactEmail } from "@/lib/platform-admin-notifications/provider-email";
import { resolveAppBaseUrl } from "@/lib/password-reset-link";
import {
  adminOrganizationDetailPath,
  newOrganizationNotificationDocId,
} from "@/lib/platform-admin-notifications/paths";

function formatRegistrationTime(value: unknown): string {
  if (value && typeof value === "object" && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate().toLocaleString("cs-CZ");
    } catch {
      /* ignore */
    }
  }
  return new Date().toLocaleString("cs-CZ");
}

export type NotifyNewOrganizationResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  notificationId?: string;
  emailSent?: boolean;
  emailSkipped?: boolean;
  emailError?: string | null;
};

/**
 * Idempotentní: jedna notifikace + jeden e-mail na organizationId.
 */
export async function notifySuperadminNewOrganizationRegistered(
  db: Firestore,
  params: {
    organizationId: string;
    ownerUserId: string;
    source?: string;
  }
): Promise<NotifyNewOrganizationResult> {
  const organizationId = params.organizationId.trim();
  if (!organizationId) {
    return { ok: false, reason: "missing_organization_id" };
  }

  const notifRef = db
    .collection(PLATFORM_ADMIN_NOTIFICATIONS_COLLECTION)
    .doc(newOrganizationNotificationDocId(organizationId));

  const existing = await notifRef.get();
  if (existing.exists) {
    return { ok: true, skipped: true, reason: "duplicate", notificationId: notifRef.id };
  }

  const orgSnap = await db.collection(COMPANIES_COLLECTION).doc(organizationId).get();
  if (!orgSnap.exists) {
    return { ok: false, reason: "organization_not_found" };
  }
  const org = orgSnap.data() as Record<string, unknown>;
  const orgName = String(org.companyName || org.name || organizationId).trim();

  const ownerSnap = await db.collection(USERS_COLLECTION).doc(params.ownerUserId).get();
  const owner = ownerSnap.data() as Record<string, unknown> | undefined;
  const ownerName = String(owner?.displayName || owner?.name || "").trim() || "—";
  const ownerEmail = String(owner?.email || org.email || "").trim() || "—";
  const phone = String(org.phone || "").trim() || "—";
  const ico = String(org.ico || "").trim() || "—";
  const licenseSnap = await db.collection(COMPANY_LICENSES_COLLECTION).doc(organizationId).get();
  const licenseData = licenseSnap.data() as { licenseId?: string; status?: string } | undefined;
  const licenseLabel = String(
    licenseData?.licenseId || org.licenseId || "starter"
  ).trim();
  const licenseStatus = String(licenseData?.status || "pending").trim();
  const registeredAt = formatRegistrationTime(org.createdAt);

  const title = `Nová registrace: ${orgName}`;
  const message = `Byla zaregistrována nová organizace: ${orgName}`;

  const metadata = {
    organizationName: orgName,
    ico,
    ownerName,
    ownerEmail,
    phone,
    ownerUserId: params.ownerUserId,
    registeredAt,
    licenseId: licenseLabel,
    licenseStatus,
    source: params.source ?? "public_register",
  };

  await notifRef.set({
    type: "NEW_ORGANIZATION_REGISTERED",
    title,
    message,
    organizationId,
    createdAt: FieldValue.serverTimestamp(),
    readAt: null,
    metadata,
    emailSentAt: null,
    emailError: null,
  });

  await db.collection(COMPANIES_COLLECTION).doc(organizationId).collection("activityLogs").add({
    organizationId,
    companyId: organizationId,
    actionType: "organization_registered",
    actionLabel: "Nová organizace byla zaregistrována",
    entityType: "organization",
    entityId: organizationId,
    entityName: orgName,
    details: `Registrace firmy (${params.source ?? "public_register"})`,
    metadata: {
      organizationId,
      ownerUserId: params.ownerUserId,
      createdAt: registeredAt,
    },
    userId: params.ownerUserId,
    status: "ok",
    sourceModule: "registration",
    createdAt: FieldValue.serverTimestamp(),
  });

  const providerEmail = await loadPlatformProviderContactEmail(db);
  let emailSent = false;
  let emailSkipped = false;
  let emailError: string | null = null;

  if (!providerEmail) {
    emailSkipped = true;
    emailError = "Provider e-mail není nastaven v billingProvider.";
    console.warn("[new-organization-notify]", emailError);
    await notifRef.update({ emailError, emailSkipped: true });
  } else {
    const base = resolveAppBaseUrl();
    const adminUrl = `${base}${adminOrganizationDetailPath(organizationId)}`;
    const subject = `RAJMONDATA – nová registrace organizace: ${orgName}`;
    const html = buildNotificationHtml({
      moduleLabel: "RAJMONDATA Platforma",
      title: "V RAJMONDATA byla vytvořena nová organizace",
      companyName: "Provozovatel platformy",
      lines: [
        `Název organizace: ${orgName}`,
        `IČO: ${ico}`,
        `Vlastník: ${ownerName}`,
        `E-mail: ${ownerEmail}`,
        `Telefon: ${phone}`,
        `Datum registrace: ${registeredAt}`,
        `ID organizace: ${organizationId}`,
        `Licence / tarif: ${licenseLabel} (${licenseStatus})`,
      ],
      actionUrl: adminUrl,
    });

    const send = await sendTransactionalEmail({
      to: [providerEmail],
      subject,
      html,
    });

    if (send.ok) {
      emailSent = true;
      await notifRef.update({
        emailSentAt: FieldValue.serverTimestamp(),
        emailError: null,
      });
    } else {
      emailError = send.error;
      console.error("[new-organization-notify] email failed", send.error, send.detail);
      await notifRef.update({
        emailError: String(send.error).slice(0, 500),
      });
    }
  }

  return {
    ok: true,
    notificationId: notifRef.id,
    emailSent,
    emailSkipped,
    emailError,
  };
}
