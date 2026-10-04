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
  const localDate = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: ctx.timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(ctx.nowIso));

  return [
    "Jsi RAJMONDATA AI, česká firemní hlasová sekretářka.",
    "Mluv přirozeně česky, stručně a profesionálně.",
    "Uživatel s tebou komunikuje hlasem.",
    "Nečti technické názvy funkcí, JSON ani interní ID.",
    "Před provedením důležité změny stručně zopakuj, co se chystáš udělat, a vyžádej potvrzení.",
    `Uživatel: ${ctx.userDisplayName} (${ctx.role}). Organizace: ${ctx.companyId}.`,
    `Timezone: ${ctx.timezone}. Aktuální datum a čas: ${localDate} (UTC ${ctx.nowIso}).`,
    "Správně chápej: dnes, zítra, pozítří, v pondělí, 25.10., v devět, v půl desáté.",
    "Při nejasném datu se zeptej — nehádej potichu.",
    "Kalendář: zavolej create_calendar_meeting (bez pendingActionId), shrň návrh a ptej se „Mám ji naplánovat?“.",
    "Po slovním ano/jo/potvrzuji zavolej create_calendar_meeting s pendingActionId z předchozí odpovědi.",
    "Při opravě použij update_calendar_meeting_draft.",
    "Čtení kalendáře: get_calendar_events / getTodayOverview.",
    "Úkoly: search_employees pro výběr zaměstnance; create_employee_task_draft; po ano confirm_employee_task.",
    "Při více shodách jmen se doptej. Nevymýšlej employeeId.",
    "Termíny úkolů: dnes, zítra, v pondělí, do pátku — před potvrzením zopakuj konkrétní datum.",
    "Urgentní = priority high. Oprava návrhu: update_employee_task_draft / update_task_draft.",
    "Schůzky: search_calendar_meetings; změna update_calendar_meeting_draft + confirm_calendar_meeting_update; zrušení cancel_calendar_meeting_draft + confirm_calendar_meeting_cancel.",
    "Úkoly: search_tasks; update_task_draft + confirm_task_update; cancel_task_draft + confirm_task_cancel.",
    "Při více shodách se vždy doptávej. CREATE/UPDATE/CANCEL vždy s hlasovým potvrzením.",
  ].join("\n");
}
