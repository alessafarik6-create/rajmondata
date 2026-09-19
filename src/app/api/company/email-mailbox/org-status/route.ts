import { NextRequest } from "next/server";
import { requireOrgEmailAdmin, emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { emailJsonErr, emailJsonOk, emailRouteErrorResponse } from "@/lib/email-mailbox/api-json";
import { listEmailAccounts } from "@/lib/email-mailbox/account-store";
import {
  migrateLegacyEmailAccountIfNeeded,
  resolveAccountOwnerUserId,
} from "@/lib/email-mailbox/account-access";
import { accountStatusLabel } from "@/lib/email-mailbox/credential-resolver";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stav připojení schránek v organizaci — bez obsahu zpráv (pouze admin/owner).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireOrgEmailAdmin(request);
    if (!auth.ok) {
      return emailJsonErr({
        status: auth.status,
        message: auth.error,
        errorCode: auth.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
      });
    }

    const companyId =
      String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || auth.caller.companyId;
    if (!emailMailboxTenantOk(auth.caller, companyId)) {
      return emailJsonErr({ status: 403, message: "Neplatná organizace.", errorCode: "TENANT_MISMATCH" });
    }

    const accountsRaw = await listEmailAccounts(auth.db, companyId);
    const accountsByUser = new Map<
      string,
      { email: string; status: string; statusLabel: string; accountType: string }[]
    >();

    for (const row of accountsRaw) {
      const account = await migrateLegacyEmailAccountIfNeeded(auth.db, companyId, row);
      const uid = resolveAccountOwnerUserId(account);
      if (!uid) continue;
      const list = accountsByUser.get(uid) ?? [];
      list.push({
        email: account.email,
        status: account.status,
        statusLabel: accountStatusLabel(account.status),
        accountType: account.accountType ?? "PERSONAL",
      });
      accountsByUser.set(uid, list);
    }

    const empSnap = await auth.db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("employees")
      .limit(500)
      .get();

    const members: {
      userId: string;
      displayName: string;
      connected: boolean;
      mailboxes: { email: string; status: string; statusLabel: string; accountType: string }[];
    }[] = [];

    const seen = new Set<string>();

    for (const doc of empSnap.docs) {
      const data = doc.data() as { authUserId?: string; name?: string; firstName?: string; lastName?: string };
      const uid = String(data.authUserId ?? "").trim();
      if (!uid || seen.has(uid)) continue;
      seen.add(uid);
      const displayName =
        String(data.name ?? "").trim() ||
        [data.firstName, data.lastName].filter(Boolean).join(" ").trim() ||
        uid.slice(0, 8);
      const mailboxes = accountsByUser.get(uid) ?? [];
      members.push({
        userId: uid,
        displayName,
        connected: mailboxes.length > 0,
        mailboxes,
      });
    }

    for (const [uid, mailboxes] of accountsByUser) {
      if (seen.has(uid)) continue;
      members.push({
        userId: uid,
        displayName: mailboxes[0]?.email ?? uid.slice(0, 8),
        connected: true,
        mailboxes,
      });
    }

    members.sort((a, b) => a.displayName.localeCompare(b.displayName, "cs"));

    return emailJsonOk({
      members,
      note: "Admin vidí pouze stav připojení, ne obsah osobních schránek.",
    });
  } catch (err) {
    console.error("[email-mailbox/org-status]", err instanceof Error ? err.message : err);
    return emailRouteErrorResponse(err, "Nepodařilo se načíst stav e-mailů v organizaci.");
  }
}
