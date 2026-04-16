import type { Firestore } from "firebase-admin/firestore";
import type { EmailModuleKey } from "./schema";
import {
  dispatchOrgModuleEmail,
  loadCompanyEmailSettings,
  resolveNotificationEmailsForModule,
  type DispatchOrgEmailInput,
} from "./dispatch";

export type { DispatchOrgEmailInput };

/**
 * E-maily příjemců pro modul podle uloženého nastavení (globální vs. vlastní seznam modulu).
 * Bez fallbacku na administrátory. Prázdné, pokud jsou notifikace vypnuté nebo modul vypnutý.
 */
export async function getNotificationRecipients(
  db: Firestore,
  companyId: string,
  module: EmailModuleKey
): Promise<string[]> {
  const settings = await loadCompanyEmailSettings(db, companyId);
  if (!settings?.enabled) return [];
  const mod = settings.modules[module];
  if (!mod || !("enabled" in mod) || mod.enabled !== true) return [];
  return resolveNotificationEmailsForModule(db, companyId, settings, module);
}

/**
 * Odešle modulovou notifikaci (stejná logika jako {@link dispatchOrgModuleEmail}).
 * Společný vstupní bod pro API route, frontu a další serverový kód.
 */
export function sendModuleNotification(
  db: Firestore | null,
  input: DispatchOrgEmailInput
) {
  return dispatchOrgModuleEmail(db, input);
}
