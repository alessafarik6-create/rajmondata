import type { Firestore } from "firebase-admin/firestore";
import {
  COMPANIES_COLLECTION,
  COMPANY_LICENSES_COLLECTION,
  ORGANIZATIONS_COLLECTION,
} from "@/lib/firestore-collections";
import type { OrgCampaignAudience } from "@/lib/platform-org-campaigns/types";
import { getEffectiveModulesMerged } from "@/lib/platform-access";

export type ResolvedOrgRecipient = {
  companyId: string;
  name: string;
  contactEmail: string | null;
  planKey: string | null;
};

async function companyDisplayName(
  db: Firestore,
  companyId: string,
  data: Record<string, unknown>
): Promise<string> {
  const local = String(data.companyName ?? data.name ?? "").trim();
  if (local) return local;
  const orgSnap = await db.collection(ORGANIZATIONS_COLLECTION).doc(companyId).get();
  const org = orgSnap.data() as Record<string, unknown> | undefined;
  return String(org?.companyName ?? org?.name ?? companyId).trim() || companyId;
}

async function companyContactEmail(data: Record<string, unknown>): Promise<string | null> {
  const candidates = [
    data.contactEmail,
    data.email,
    data.billingEmail,
    data.ownerEmail,
  ];
  for (const c of candidates) {
    const e = String(c ?? "").trim().toLowerCase();
    if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return e;
  }
  return null;
}

function parseIsoMs(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const t = Date.parse(s.length === 10 ? `${s}T12:00:00` : s);
  return Number.isNaN(t) ? null : t;
}

function daysUntil(iso: string | null | undefined): number | null {
  const t = parseIsoMs(iso);
  if (t == null) return null;
  return Math.ceil((t - Date.now()) / (24 * 60 * 60 * 1000));
}

export async function resolveOrgCampaignRecipients(
  db: Firestore,
  audience: OrgCampaignAudience,
  search?: string,
  opts?: { requireMarketingConsent?: boolean }
): Promise<ResolvedOrgRecipient[]> {
  const q = String(search ?? "").trim().toLowerCase();
  const snap = await db.collection(COMPANIES_COLLECTION).limit(500).get();
  const out: ResolvedOrgRecipient[] = [];

  for (const doc of snap.docs) {
    const data = (doc.data() ?? {}) as Record<string, unknown>;
    if (data.deletedAt || data.status === "deleted") continue;
    if (opts?.requireMarketingConsent && data.platformMarketingUnsubscribedAt) continue;
    const name = await companyDisplayName(db, doc.id, data);
    if (q && !name.toLowerCase().includes(q) && !doc.id.toLowerCase().includes(q)) continue;

    const licenseSnap = await db.collection(COMPANY_LICENSES_COLLECTION).doc(doc.id).get();
    const license = licenseSnap.data() as Record<string, unknown> | undefined;
    const planKey = String(license?.planKey ?? license?.plan ?? data.planKey ?? "").trim() || null;
    const modules = getEffectiveModulesMerged({
      modules: data.modules as Record<string, boolean> | undefined,
      license: license
        ? {
            modules: license.modules as Record<string, boolean> | undefined,
            enabledModules: license.enabledModules as string[] | undefined,
          }
        : undefined,
    });

    let include = false;
    switch (audience.mode) {
      case "all":
        include = true;
        break;
      case "selected":
        include = (audience.companyIds ?? []).includes(doc.id);
        break;
      case "plan":
        include = Boolean(planKey && (audience.planKeys ?? []).includes(planKey));
        break;
      case "licensed":
        include = Boolean(license?.active === true || license?.status === "active");
        break;
      case "active":
        include = Boolean(license?.active === true || license?.status === "active");
        break;
      case "inactive":
        include = !(
          license?.active === true ||
          license?.status === "active"
        );
        break;
      case "subscription_ending": {
        const exp = String(license?.expiresAt ?? license?.trialEndsAt ?? "").trim();
        const days = daysUntil(exp);
        include = days != null && days >= 0 && days <= 14;
        break;
      }
      case "modules": {
        const keys = audience.moduleKeys ?? [];
        include = keys.some((k) => modules[k] === true);
        break;
      }
      default:
        include = false;
    }
    if (!include) continue;

    out.push({
      companyId: doc.id,
      name,
      contactEmail: await companyContactEmail(data),
      planKey,
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name, "cs"));
  return out;
}

export async function loadOrgAdminUserIds(
  db: Firestore,
  companyId: string
): Promise<string[]> {
  const qs = await db
    .collection("users")
    .where("companyId", "==", companyId)
    .limit(50)
    .get();
  const ids: string[] = [];
  for (const d of qs.docs) {
    const role = String(d.data()?.role ?? "");
    if (role === "owner" || role === "admin") ids.push(d.id);
  }
  return ids;
}
