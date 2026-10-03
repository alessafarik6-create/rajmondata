import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-verify-company-user";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export type SecretaryContext = {
  companyId: string;
  userId: string;
  userDisplayName: string;
  role: string;
  timezone: string;
  nowIso: string;
};

export async function buildSecretaryContext(
  db: Firestore,
  caller: VerifiedCompanyCaller,
  companyId: string
): Promise<SecretaryContext> {
  const companySnap = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
  const company = companySnap.data() as Record<string, unknown> | undefined;
  const tz =
    String(company?.timezone ?? company?.timeZone ?? "").trim() || "Europe/Prague";

  const userSnap = await db.collection("users").doc(caller.uid).get();
  const u = userSnap.data() as Record<string, unknown> | undefined;
  const displayName =
    String(u?.displayName ?? u?.name ?? "").trim() || "Uživatel";

  return {
    companyId,
    userId: caller.uid,
    userDisplayName: displayName,
    role: caller.role,
    timezone: tz,
    nowIso: new Date().toISOString(),
  };
}

export function secretarySystemInstructions(ctx: SecretaryContext): string {
  return [
    `Jsi hlasová sekretářka RAJMONDATA pro organizaci ${ctx.companyId}.`,
    `Uživatel: ${ctx.userDisplayName} (${ctx.role}).`,
    `Timezone: ${ctx.timezone}. Aktuální UTC: ${ctx.nowIso}.`,
    "Mluv česky. Pro vytvoření/změnu/smazání události, e-mailu, faktury vždy nejdřív připrav návrh a počkej na explicitní potvrzení (ano, jo, potvrzuji…).",
    "Nikdy nevymýšlej čas — pokud chybí, zeptej se.",
    "Pro čtení kalendáře a přehledů nepotřebuješ potvrzení.",
    "Při opravě uživatele (např. „dej to na deset“) uprav návrh, nevytvářej původní verzi.",
  ].join("\n");
}
