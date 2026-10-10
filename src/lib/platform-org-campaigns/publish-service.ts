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
import { buildOrgCampaignEmailHtml } from "@/lib/platform-org-campaigns/email-template";
import {
  loadOrgAdminUserIds,
  resolveOrgCampaignRecipients,
} from "@/lib/platform-org-campaigns/recipient-resolver";
import type { OrgCampaignDoc } from "@/lib/platform-org-campaigns/types";

function appBaseUrl(): string {
  return (
    String(process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "") ||
    "https://rajmondata.cz"
  );
}

function campaignPortalUrl(campaignId: string): string {
  return `${appBaseUrl()}/portal/campaigns/${encodeURIComponent(campaignId)}`;
}

export type PublishOrgCampaignResult = {
  targeted: number;
  emailsQueued: number;
  notificationsCreated: number;
  batchId: string;
};

export async function publishOrgCampaignAdmin(
  db: Firestore,
  campaignId: string,
  opts?: { resendEmail?: boolean; actorUsername?: string }
): Promise<PublishOrgCampaignResult> {
  const ref = db.collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION).doc(campaignId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Kampaň neexistuje.");
  const campaign = snap.data() as OrgCampaignDoc;
  if (campaign.status === "archived") throw new Error("Archivovanou kampaň nelze publikovat.");

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
  const recipients = await resolveOrgCampaignRecipients(db, campaign.audience);
  let emailsQueued = 0;
  let notificationsCreated = 0;

  const writeBatch = db.batch();
  for (const r of recipients) {
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

    const recipientRef = ref.collection("recipients").doc(r.companyId);
    writeBatch.set(
      recipientRef,
      {
        organizationId: r.companyId,
        organizationName: r.name,
        deliveredAt: now,
        emailStatus: campaign.emailNotify ? "pending" : null,
      },
      { merge: true }
    );
  }

  writeBatch.set(
    ref,
    {
      status: "active",
      publishedAt: now,
      publishBatchId: batchId,
      stats: {
        targeted: recipients.length,
        interested: campaign.stats?.interested ?? 0,
        declined: campaign.stats?.declined ?? 0,
        support: campaign.stats?.support ?? 0,
        opened: campaign.stats?.opened ?? 0,
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

  for (const r of recipients) {
    const uids = adminIdsByOrg.get(r.companyId) ?? [];
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
        eventId: `platform-campaign:${campaignId}:${uid}`,
        forcePush: false,
      });
      notificationsCreated += 1;
    }

    if (campaign.emailNotify) {
      const dedupId = createHash("sha256")
        .update(`${campaignId}:${r.companyId}:${batchId}`)
        .digest("hex")
        .slice(0, 40);
      const dedupRef = db.collection("mail_notify_dedup").doc(`pc_${dedupId}`);
      const dedupSnap = await dedupRef.get();
      if (dedupSnap.exists && !opts?.resendEmail) continue;
      await dedupRef.set({ createdAt: FieldValue.serverTimestamp() });

      const toList: string[] = [];
      if (r.contactEmail) toList.push(r.contactEmail);
      for (const uid of uids) {
        const u = await db.collection("users").doc(uid).get();
        const em = String(u.data()?.email ?? "").trim().toLowerCase();
        if (em && !toList.includes(em)) toList.push(em);
      }
      if (!toList.length) continue;

      await db.collection(MAIL_DISPATCH_QUEUE).add({
        kind: "platform_campaign_email",
        campaignId,
        organizationId: r.companyId,
        organizationName: r.name,
        to: toList,
        subject:
          campaign.emailSubject?.trim() ||
          `RAJMONDATA – ${campaign.title}`.slice(0, 200),
        html: buildOrgCampaignEmailHtml({
          organizationName: r.name,
          title: campaign.title,
          shortDescription: campaign.shortDescription,
          imageUrl: campaign.imageUrl,
          campaignUrl: campaignPortalUrl(campaignId),
          customHtml: campaign.emailHtml,
        }),
        sendAt: Timestamp.now(),
        batchId,
        createdAt: FieldValue.serverTimestamp(),
      });
      emailsQueued += 1;
      await ref.collection("recipients").doc(r.companyId).set(
        { emailStatus: "queued", emailSentAt: null },
        { merge: true }
      );
    }
  }

  await ref.collection("audit").add({
    action: opts?.resendEmail ? "republish_email" : "publish",
    at: FieldValue.serverTimestamp(),
    actor: opts?.actorUsername ?? null,
    targeted: recipients.length,
    batchId,
  });

  return {
    targeted: recipients.length,
    emailsQueued,
    notificationsCreated,
    batchId,
  };
}
