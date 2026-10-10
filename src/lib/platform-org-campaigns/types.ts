import type { Timestamp } from "firebase-admin/firestore";

export type OrgCampaignType =
  | "message"
  | "news"
  | "offer"
  | "promo"
  | "alert"
  | "support";

export type OrgCampaignStatus =
  | "draft"
  | "scheduled"
  | "active"
  | "ended"
  | "archived";

export type OrgCampaignAudienceMode =
  | "all"
  | "selected"
  | "plan"
  | "modules"
  | "licensed";

export type OrgCampaignAudience = {
  mode: OrgCampaignAudienceMode;
  companyIds?: string[];
  planKeys?: string[];
  moduleKeys?: string[];
};

export type OrgCampaignReactionKind = "interested" | "declined" | "support";

export type OrgCampaignDoc = {
  title: string;
  shortDescription: string;
  bodyHtml: string;
  type: OrgCampaignType;
  status: OrgCampaignStatus;
  audience: OrgCampaignAudience;
  imageUrl?: string | null;
  imageStoragePath?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  publishAt?: Timestamp | null;
  endAt?: Timestamp | null;
  emailNotify?: boolean;
  emailSubject?: string | null;
  emailHtml?: string | null;
  emailMarketing?: boolean;
  stats?: {
    targeted?: number;
    interested?: number;
    declined?: number;
    support?: number;
    opened?: number;
  };
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  publishedAt?: Timestamp | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  publishBatchId?: string | null;
};

export type OrgCampaignInboxDoc = {
  campaignId: string;
  organizationId: string;
  title: string;
  shortDescription: string;
  bodyHtml: string;
  type: OrgCampaignType;
  imageUrl?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  publishAt?: Timestamp | null;
  endAt?: Timestamp | null;
  status: "active" | "hidden" | "expired";
  reaction?: OrgCampaignReactionKind | null;
  hiddenFromDashboard?: boolean;
  openedAt?: Timestamp | null;
  deliveredAt?: Timestamp | null;
};

export type OrgCampaignRecipientDoc = {
  organizationId: string;
  organizationName: string;
  deliveredAt?: Timestamp | null;
  openedAt?: Timestamp | null;
  emailStatus?: "pending" | "queued" | "sent" | "error";
  emailSentAt?: Timestamp | null;
  emailError?: string | null;
  reaction?: OrgCampaignReactionKind | null;
  reactedAt?: Timestamp | null;
  reactedByUserId?: string | null;
};

export const ORG_CAMPAIGN_TYPE_LABELS: Record<OrgCampaignType, string> = {
  message: "Běžná zpráva",
  news: "Novinka",
  offer: "Speciální nabídka",
  promo: "Akce",
  alert: "Důležité upozornění",
  support: "Pomoc a podpora",
};
