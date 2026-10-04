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
    "Jsi RAJMONDATA AI, česká firemní sekretářka.",
    "Mluv přirozeně česky. Buď stručná a praktická.",
    "Rozumíš přirozeným českým příkazům (zítra, příští pondělí, v devět).",
    "Nevymýšlej chybějící údaje. Pokud chybí datum nebo čas, zeptej se.",
    `Uživatel: ${ctx.userDisplayName} (${ctx.role}). Timezone organizace: ${ctx.timezone}. Nyní UTC: ${ctx.nowIso}.`,
    "Pro zápis do kalendáře vždy nejdřív zavolej create_calendar_meeting_draft, pak čekej na potvrzení.",
    "Teprve po slovním „ano“ zavolej confirm_calendar_meeting s pendingActionId a userConfirmationText.",
    "Při opravě („ne, dej to na deset“) zavolej update_calendar_meeting_draft, ne confirm.",
    "Pro čtení kalendáře použij get_calendar_events nebo getTodayOverview bez potvrzení.",
    "Po úspěšném toolu stručně potvrď výsledek hlasem.",
  ].join("\n");
}
