import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import {
  COMPANIES_COLLECTION,
  COMPANY_LICENSES_COLLECTION,
  ORGANIZATIONS_COLLECTION,
} from "@/lib/firestore-collections";
import type { OrgCampaignAudience } from "@/lib/platform-org-campaigns/types";
import { getEffectiveModulesMerged } from "@/lib/platform-access";

export type OrgLicenseFilter = "all" | "active" | "trial" | "inactive";

export type ResolvedOrgRecipient = {
  companyId: string;
  name: string;
  ico: string | null;
  contactEmail: string | null;
  planKey: string | null;
  licenseStatus: "active" | "trial" | "inactive";
  marketingUnsubscribed: boolean;
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

function companyContactEmail(data: Record<string, unknown>): string | null {
  const candidates = [data.contactEmail, data.email, data.billingEmail, data.ownerEmail];
  for (const c of candidates) {
    const e = String(c ?? "").trim().toLowerCase();
    if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return e;
  }
  return null;
}

function companyIco(data: Record<string, unknown>): string | null {
  const ico = String(data.ico ?? data.ic ?? data.companyIco ?? "").trim();
  return ico || null;
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

function licenseStatusFrom(
  license: Record<string, unknown> | undefined,
  data: Record<string, unknown>
): "active" | "trial" | "inactive" {
  const status = String(license?.status ?? data.licenseStatus ?? "").toLowerCase();
  if (status === "trial" || license?.isTrial === true) return "trial";
  if (license?.active === true || status === "active") return "active";
  return "inactive";
}

function matchesSearch(
  q: string,
  name: string,
  companyId: string,
  ico: string | null,
  email: string | null
): boolean {
  if (!q) return true;
  const hay = [name, companyId, ico ?? "", email ?? ""].join(" ").toLowerCase();
  return hay.includes(q);
}

async function loadAllCompanies(db: Firestore): Promise<
  Array<{ id: string; data: Record<string, unknown> }>
> {
  const out: Array<{ id: string; data: Record<string, unknown> }> = [];
  let last: QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = db.collection(COMPANIES_COLLECTION).orderBy("__name__").limit(400);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      out.push({ id: doc.id, data: (doc.data() ?? {}) as Record<string, unknown> });
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 400) break;
  }
  return out;
}

export async function resolveOrgCampaignRecipients(
  db: Firestore,
  audience: OrgCampaignAudience,
  search?: string,
  opts?: { requireMarketingConsent?: boolean; licenseFilter?: OrgLicenseFilter }
): Promise<ResolvedOrgRecipient[]> {
  const q = String(search ?? "").trim().toLowerCase();
  const licenseFilter = opts?.licenseFilter ?? "all";
  const companies = await loadAllCompanies(db);
  const out: ResolvedOrgRecipient[] = [];

  for (const { id: companyId, data } of companies) {
    if (data.deletedAt || data.status === "deleted") continue;
    const marketingUnsubscribed = Boolean(data.platformMarketingUnsubscribedAt);
    if (opts?.requireMarketingConsent && marketingUnsubscribed) continue;

    const name = await companyDisplayName(db, companyId, data);
    const ico = companyIco(data);
    const contactEmail = companyContactEmail(data);
    if (!matchesSearch(q, name, companyId, ico, contactEmail)) continue;

    const licenseSnap = await db.collection(COMPANY_LICENSES_COLLECTION).doc(companyId).get();
    const license = licenseSnap.data() as Record<string, unknown> | undefined;
    const planKey = String(license?.planKey ?? license?.plan ?? data.planKey ?? "").trim() || null;
    const licenseStatus = licenseStatusFrom(license, data);
    const modules = getEffectiveModulesMerged({
      modules: data.modules as Record<string, boolean> | undefined,
      license: license
        ? {
            modules: license.modules as Record<string, boolean> | undefined,
            enabledModules: license.enabledModules as string[] | undefined,
          }
        : undefined,
    });

    if (licenseFilter !== "all" && licenseStatus !== licenseFilter) continue;

    let include = false;
    switch (audience.mode) {
      case "all":
        include = true;
        break;
      case "selected":
        include = (audience.companyIds ?? []).includes(companyId);
        break;
      case "plan":
        include = Boolean(planKey && (audience.planKeys ?? []).includes(planKey));
        break;
      case "licensed":
      case "active":
        include = licenseStatus === "active";
        break;
      case "trial":
        include = licenseStatus === "trial";
        break;
      case "inactive":
        include = licenseStatus === "inactive";
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
      companyId,
      name,
      ico,
      contactEmail,
      planKey,
      licenseStatus,
      marketingUnsubscribed,
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
