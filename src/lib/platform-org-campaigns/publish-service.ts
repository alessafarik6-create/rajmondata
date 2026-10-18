import { createHash, randomUUID } from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  COMPANIES_COLLECTION,
  PLATFORM_CAMPAIGN_INBOX_SUBCOLLECTION,
  PLATFORM_ORG_CAMPAIGNS_COLLECTION,
} from "@/lib/firestore-collections";
import { MAIL_DISPATCH_QUEUE } from "@/lib/email-notifications/dispatch";
import { createNotification } from "@/lib/notification-service/notification-service";
import { buildOrgCampaignEmailForRecipient } from "@/lib/platform-org-campaigns/email-template";
import {
  loadOrgAdminUserIds,
  resolveOrgCampaignRecipients,
} from "@/lib/platform-org-campaigns/recipient-resolver";
import type {
  OrgCampaignDeliveryChannel,
  OrgCampaignDoc,
} from "@/lib/platform-org-campaigns/types";

function appBaseUrl(): string {
  return (
    String(process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "") ||
    "https://rajmondata.cz"
  );
}

function campaignPortalUrl(campaignId: string): string {
  return `${appBaseUrl()}/portal/campaigns/${encodeURIComponent(campaignId)}`;
}

function consultationUrl(): string {
  return `${appBaseUrl()}/rezervace-konzultace`;
}

export type PublishOrgCampaignOptions = {
  resendEmail?: boolean;
  actorUsername?: string;
  deliveryChannel?: OrgCampaignDeliveryChannel;
};

export type PublishOrgCampaignResult = {
  targeted: number;
  emailsQueued: number;
  notificationsCreated: number;
  batchId: string;
  dashboardDelivered: number;
};

function resolveChannel(
  campaign: OrgCampaignDoc,
  override?: OrgCampaignDeliveryChannel
): OrgCampaignDeliveryChannel {
  if (override) return override;
  if (campaign.deliveryChannel) return campaign.deliveryChannel;
  if (campaign.emailNotify === false) return "dashboard";
  return "both";
}

async function collectOrgEmails(
  db: Firestore,
  r: { companyId: string; contactEmail: string | null },
  adminUids: string[]
): Promise<string[]> {
  const toList: string[] = [];
  if (r.contactEmail) toList.push(r.contactEmail.toLowerCase());
  for (const uid of adminUids) {
    const u = await db.collection("users").doc(uid).get();
    const em = String(u.data()?.email ?? "").trim().toLowerCase();
    if (em && !toList.includes(em)) toList.push(em);
  }
  return toList;
}

export async function publishOrgCampaignAdmin(
  db: Firestore,
  campaignId: string,
  opts?: PublishOrgCampaignOptions
): Promise<PublishOrgCampaignResult> {
  const ref = db.collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION).doc(campaignId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Kampaň neexistuje.");
  const campaign = snap.data() as OrgCampaignDoc;
  if (campaign.status === "archived") throw new Error("Archivovanou kampaň nelze publikovat.");

  const channel = resolveChannel(campaign, opts?.deliveryChannel);
  const sendDashboard = channel === "both" || channel === "dashboard";
  const sendEmail = channel === "both" || channel === "email";
  const marketing = campaign.emailMarketing !== false;

  const now = Timestamp.now();
  const publishAt = campaign.publishAt ?? now;
  if (publishAt.toMillis() > now.toMillis() + 60_000) {
    await ref.set(
      { status: "scheduled", publishAt, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    throw new Error("Kampaň je naplánována — publikace proběhne po datu zveřejnění (cron).");
  }

  const batchId = randomUUID();
  if (
    campaign.audience?.mode === "selected" &&
    !(campaign.audience.companyIds ?? []).length
  ) {
    throw new Error("Vyberte alespoň jednu organizaci pro režim „Vybrané organizace“.");
  }
  const recipients = await resolveOrgCampaignRecipients(db, campaign.audience, undefined, {
    requireMarketingConsent: sendEmail && marketing,
  });
  if (!recipients.length) {
    throw new Error("Pro zvolené publikum nebyl nalezen žádný příjemce.");
  }
  let emailsQueued = 0;
  let notificationsCreated = 0;
  let dashboardDelivered = 0;

  const writeBatch = db.batch();
  for (const r of recipients) {
    if (sendDashboard) {
      const inboxRef = db
        .collection(COMPANIES_COLLECTION)
        .doc(r.companyId)
        .collection(PLATFORM_CAMPAIGN_INBOX_SUBCOLLECTION)
        .doc(campaignId);
      writeBatch.set(
        inboxRef,
        {
          campaignId,
          organizationId: r.companyId,
          title: campaign.title,
          shortDescription: campaign.shortDescription,
          bodyHtml: campaign.bodyHtml,
          type: campaign.type,
          imageUrl: campaign.imageUrl ?? null,
          ctaLabel: campaign.ctaLabel ?? null,
          ctaUrl: campaign.ctaUrl ?? null,
          publishAt,
          endAt: campaign.endAt ?? null,
          status: "active",
          hiddenFromDashboard: false,
          deliveredAt: now,
        },
        { merge: true }
      );
      dashboardDelivered += 1;
    }

    const recipientRef = ref.collection("recipients").doc(r.companyId);
    writeBatch.set(
      recipientRef,
      {
        organizationId: r.companyId,
        organizationName: r.name,
        deliveredAt: sendDashboard ? now : FieldValue.serverTimestamp(),
        emailStatus: sendEmail ? "pending" : null,
        lastBatchId: batchId,
      },
      { merge: true }
    );
  }

  const prevStats = campaign.stats ?? {};
  writeBatch.set(
    ref,
    {
      status: "active",
      publishedAt: campaign.publishedAt ?? now,
      publishBatchId: batchId,
      deliveryChannel: channel,
      stats: {
        targeted: recipients.length,
        interested: prevStats.interested ?? 0,
        declined: prevStats.declined ?? 0,
        support: prevStats.support ?? 0,
        opened: prevStats.opened ?? 0,
        emailsSent: prevStats.emailsSent ?? 0,
        emailsError: prevStats.emailsError ?? 0,
        emailsQueued: prevStats.emailsQueued ?? 0,
        linkClicks: prevStats.linkClicks ?? 0,
        consultationsBooked: prevStats.consultationsBooked ?? 0,
        marketingUnsubscribes: prevStats.marketingUnsubscribes ?? 0,
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await writeBatch.commit();

  const adminIdsByOrg = new Map<string, string[]>();
  for (const r of recipients) {
    adminIdsByOrg.set(r.companyId, await loadOrgAdminUserIds(db, r.companyId));
  }

  const base = appBaseUrl();
  const consult = campaign.consultationEnabled ? consultationUrl() : null;
  const recipientSnapshot: Array<{
    organizationId: string;
    organizationName: string;
    contactEmail: string | null;
    targetEmails: string[];
  }> = [];

  for (const r of recipients) {
    const uids = adminIdsByOrg.get(r.companyId) ?? [];
    if (sendDashboard) {
      for (const uid of uids) {
        await createNotification({
          recipientUserId: uid,
          organizationId: r.companyId,
          type: "SYSTEM_ALERT",
          category: "system",
          title: "RAJMONDATA — nová zpráva pro vaši firmu",
          body: campaign.title,
          url: `/portal/campaigns/${campaignId}`,
          entityType: "system",
          entityId: campaignId,
          eventId: `platform-campaign:${campaignId}:${uid}:${batchId}`,
          forcePush: false,
        });
        notificationsCreated += 1;
      }
    }

    if (sendEmail) {
      const dedupId = createHash("sha256")
        .update(`${campaignId}:${r.companyId}:${batchId}`)
        .digest("hex")
        .slice(0, 40);
      const dedupRef = db.collection("mail_notify_dedup").doc(`pc_${dedupId}`);
      const dedupSnap = await dedupRef.get();
      if (dedupSnap.exists && !opts?.resendEmail) continue;
      await dedupRef.set({ createdAt: FieldValue.serverTimestamp() });

      const toList = await collectOrgEmails(db, r, uids);
      recipientSnapshot.push({
        organizationId: r.companyId,
        organizationName: r.name,
        contactEmail: r.contactEmail,
        targetEmails: toList,
      });
      if (!toList.length) {
        await ref.collection("recipients").doc(r.companyId).set(
          {
            emailStatus: "error",
            emailError: "Chybí platná e-mailová adresa.",
            targetEmails: [],
            lastBatchId: batchId,
          },
          { merge: true }
        );
        continue;
      }

      const mailJobRef = ref.collection("mailJobs").doc();
      const html = buildOrgCampaignEmailForRecipient({
        organizationId: r.companyId,
        organizationName: r.name,
        title: campaign.title,
        shortDescription: campaign.shortDescription,
        bodyHtml: campaign.bodyHtml,
        imageUrl: campaign.imageUrl,
        campaignUrl: campaignPortalUrl(campaignId),
        ctaLabel: campaign.ctaLabel,
        ctaUrl: campaign.ctaUrl ?? campaignPortalUrl(campaignId),
        consultationUrl: consult,
        customHtml: campaign.emailHtml,
        appBaseUrl: base,
        emailMarketing: marketing,
      });

      await mailJobRef.set({
        batchId,
        organizationId: r.companyId,
        organizationName: r.name,
        to: toList,
        status: "queued",
        attempts: 0,
        queuedAt: FieldValue.serverTimestamp(),
      });

      await db.collection(MAIL_DISPATCH_QUEUE).add({
        kind: "platform_campaign_email",
        status: "pending",
        campaignId,
        organizationId: r.companyId,
        organizationName: r.name,
        mailJobId: mailJobRef.id,
        to: toList,
        subject:
          campaign.emailSubject?.trim() ||
          `RAJMONDATA – ${campaign.title}`.slice(0, 200),
        html,
        sendAt: Timestamp.now(),
        batchId,
        attempts: 0,
        createdAt: FieldValue.serverTimestamp(),
      });
      emailsQueued += 1;
      await ref.collection("recipients").doc(r.companyId).set(
        {
          emailStatus: "queued",
          emailSentAt: null,
          targetEmails: toList,
          lastBatchId: batchId,
          queuedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  await ref.collection("sendBatches").doc(batchId).set({
    batchId,
    deliveryChannel: channel,
    targeted: recipients.length,
    emailsQueued,
    emailsSent: 0,
    emailsError: 0,
    notificationsCreated,
    dashboardDelivered,
    resend: Boolean(opts?.resendEmail),
    actor: opts?.actorUsername ?? null,
    audienceMode: campaign.audience?.mode ?? "all",
    audienceCompanyIds: campaign.audience?.companyIds ?? [],
    recipientSnapshot,
    createdAt: FieldValue.serverTimestamp(),
  });

  await ref.collection("audit").add({
    action: opts?.resendEmail ? "republish" : "publish",
    at: FieldValue.serverTimestamp(),
    actor: opts?.actorUsername ?? null,
    targeted: recipients.length,
    batchId,
    deliveryChannel: channel,
  });

  await ref.set(
    {
      stats: {
        ...campaign.stats,
        targeted: recipients.length,
        emailsQueued: (campaign.stats?.emailsQueued ?? 0) + emailsQueued,
      },
    },
    { merge: true }
  );

  return {
    targeted: recipients.length,
    emailsQueued,
    notificationsCreated,
    batchId,
    dashboardDelivered,
  };
}

export async function sendOrgCampaignTestEmail(
  db: Firestore,
  campaignId: string,
  input: { to: string; subject?: string; actorUsername?: string }
): Promise<{ ok: true; providerMessage?: string | null } | { ok: false; error: string }> {
  const { sendTransactionalEmail } = await import("@/lib/email-notifications/resend-send");
  const ref = db.collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION).doc(campaignId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "Kampaň neexistuje." };
  const campaign = snap.data() as OrgCampaignDoc;
  const to = String(input.to ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { ok: false, error: "Neplatný e-mail." };
  }
  const base = appBaseUrl();
  const subject = `[TEST] ${String(input.subject ?? campaign.emailSubject ?? campaign.title).trim()}`.slice(
    0,
    200
  );
  const html = buildOrgCampaignEmailForRecipient({
    organizationId: "test-org",
    organizationName: "Testovací organizace",
    title: campaign.title,
    shortDescription: campaign.shortDescription,
    bodyHtml: campaign.bodyHtml,
    imageUrl: campaign.imageUrl,
    campaignUrl: campaignPortalUrl(campaignId),
    ctaLabel: campaign.ctaLabel,
    ctaUrl: campaign.ctaUrl ?? campaignPortalUrl(campaignId),
    consultationUrl: campaign.consultationEnabled ? consultationUrl() : null,
    customHtml: campaign.emailHtml,
    appBaseUrl: base,
    emailMarketing: true,
    isTest: true,
  });
  const sent = await sendTransactionalEmail({ to: [to], subject, html });
  await ref.collection("audit").add({
    action: "test_email",
    at: FieldValue.serverTimestamp(),
    actor: input.actorUsername ?? null,
    to,
  });
  if (!sent.ok) return { ok: false, error: sent.error };
  return {
    ok: true,
    providerMessage:
      sent.ok && "messageId" in sent ? sent.messageId ?? "accepted" : "accepted",
  };
}
