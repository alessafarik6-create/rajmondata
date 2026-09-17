import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { PLATFORM_ADMIN_NOTIFICATIONS_COLLECTION } from "@/lib/firestore-collections";
import { buildNotificationHtml, sendTransactionalEmail } from "@/lib/email-notifications/resend-send";
import { loadPlatformProviderContactEmail } from "@/lib/platform-admin-notifications/provider-email";
import { resolveAppBaseUrl } from "@/lib/password-reset-link";

const TEST_NOTIF_ID = "TEST_NEW_ORGANIZATION_REGISTRATION";

export async function sendTestNewOrganizationNotification(db: Firestore): Promise<{
  notificationOk: boolean;
  emailOk: boolean;
  emailError?: string;
}> {
  const now = new Date().toLocaleString("cs-CZ");
  const title = "[TEST] Nová organizace: TEST Firma s.r.o.";
  const message =
    "Toto je testovací upozornění. Nebyla vytvořena žádná skutečná organizace.";

  await db.collection(PLATFORM_ADMIN_NOTIFICATIONS_COLLECTION).doc(TEST_NOTIF_ID).set({
    type: "TEST_NEW_ORGANIZATION_REGISTRATION",
    title,
    message,
    organizationId: null,
    createdAt: FieldValue.serverTimestamp(),
    readAt: null,
    metadata: {
      organizationName: "TEST Firma s.r.o.",
      ico: "12345678",
      ownerName: "Testovací uživatel",
      ownerEmail: "test@example.com",
      registeredAt: now,
      test: true,
    },
  });

  const providerEmail = await loadPlatformProviderContactEmail(db);
  if (!providerEmail) {
    return { notificationOk: true, emailOk: false, emailError: "Provider e-mail není v billingProvider." };
  }

  const html = buildNotificationHtml({
    moduleLabel: "RAJMONDATA Platforma",
    title: "Toto je testovací upozornění",
    companyName: "Provozovatel platformy",
    lines: [
      "Nebyla vytvořena žádná skutečná organizace.",
      "Název: TEST Firma s.r.o.",
      "IČO: 12345678",
      "Vlastník: Testovací uživatel",
      "E-mail: test@example.com",
      `Čas: ${now}`,
    ],
    actionUrl: `${resolveAppBaseUrl()}/admin/companies`,
  });

  const send = await sendTransactionalEmail({
    to: [providerEmail],
    subject: "[TEST] RAJMONDATA – nová registrace organizace",
    html,
  });

  return {
    notificationOk: true,
    emailOk: send.ok,
    emailError: send.ok ? undefined : send.error,
  };
}

export async function sendTestSecurityAlert(db: Firestore): Promise<{
  notificationOk: boolean;
  emailOk: boolean;
  emailError?: string;
}> {
  const providerEmail = await loadPlatformProviderContactEmail(db);
  if (!providerEmail) {
    return {
      notificationOk: true,
      emailOk: false,
      emailError: "Provider e-mail není v billingProvider.",
    };
  }

  const html = buildNotificationHtml({
    moduleLabel: "RAJMONDATA Security",
    title: "Test bezpečnostního upozornění",
    companyName: "Provozovatel platformy",
    lines: [
      "Toto je test bezpečnostního upozornění. Nebyl detekován skutečný útok.",
      `Čas: ${new Date().toLocaleString("cs-CZ")}`,
    ],
    actionUrl: `${resolveAppBaseUrl()}/admin/security`,
  });

  const send = await sendTransactionalEmail({
    to: [providerEmail],
    subject: "[TEST] RAJMONDATA – bezpečnostní upozornění",
    html,
  });

  await db.collection(PLATFORM_ADMIN_NOTIFICATIONS_COLLECTION).doc("TEST_SECURITY_ALERT").set(
    {
      type: "TEST_SECURITY_ALERT",
      title: "[TEST] Bezpečnostní upozornění",
      message: "Test — žádný skutečný útok.",
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
      metadata: { test: true },
    },
    { merge: true }
  );

  return {
    notificationOk: true,
    emailOk: send.ok,
    emailError: send.ok ? undefined : send.error,
  };
}
