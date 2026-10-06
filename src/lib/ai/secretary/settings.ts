import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export const AI_SECRETARY_SETTINGS_DOC_ID = "default";

export type AiSecretaryModuleToggle = {
  enabled: boolean;
  read: boolean;
  create?: boolean;
  update?: boolean;
  delete?: boolean;
  draft?: boolean;
  send?: boolean;
  open?: boolean;
  write?: boolean;
};

export type AiSecretarySettingsDoc = {
  enabled: boolean;
  modules: {
    calendar: AiSecretaryModuleToggle & {
      read: boolean;
      create: boolean;
      update: boolean;
      delete: boolean;
    };
    tasks: AiSecretaryModuleToggle & {
      read: boolean;
      create: boolean;
      update: boolean;
      delete: boolean;
    };
    email: AiSecretaryModuleToggle & {
      read: boolean;
      draft: boolean;
      send: boolean;
    };
    jobs: AiSecretaryModuleToggle & {
      read: boolean;
      open: boolean;
      write: boolean;
    };
    customers: AiSecretaryModuleToggle & { read: boolean };
    offers: AiSecretaryModuleToggle & { read: boolean };
    inquiries: AiSecretaryModuleToggle & { read: boolean };
    invoices: AiSecretaryModuleToggle & { read: boolean };
    bank: AiSecretaryModuleToggle & { read: boolean };
    warehouse: AiSecretaryModuleToggle & { read: boolean };
    aiMemory: AiSecretaryModuleToggle & {
      read: boolean;
      create: boolean;
      update: boolean;
      disable: boolean;
    };
  };
  updatedAt?: unknown;
  updatedByUserId?: string | null;
};

export function defaultAiSecretarySettings(): AiSecretarySettingsDoc {
  return {
    enabled: true,
    modules: {
      calendar: { enabled: true, read: true, create: true, update: true, delete: true },
      tasks: { enabled: true, read: true, create: true, update: true, delete: true },
      email: { enabled: true, read: true, draft: true, send: true },
      jobs: { enabled: true, read: true, open: true, write: false },
      customers: { enabled: false, read: false },
      offers: { enabled: false, read: false },
      inquiries: { enabled: false, read: false },
      invoices: { enabled: false, read: false },
      bank: { enabled: false, read: false },
      warehouse: { enabled: false, read: false },
      aiMemory: { enabled: true, read: true, create: true, update: true, disable: true },
    },
  };
}

export async function loadAiSecretarySettings(
  db: Firestore,
  companyId: string
): Promise<AiSecretarySettingsDoc> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("ai_secretary_settings")
    .doc(AI_SECRETARY_SETTINGS_DOC_ID)
    .get();
  if (!snap.exists) return defaultAiSecretarySettings();
  const raw = snap.data() as Partial<AiSecretarySettingsDoc>;
  const base = defaultAiSecretarySettings();
  return {
    enabled: raw.enabled !== false,
    modules: {
      ...base.modules,
      ...(raw.modules as AiSecretarySettingsDoc["modules"] | undefined),
    },
    updatedAt: raw.updatedAt,
    updatedByUserId: raw.updatedByUserId ?? null,
  };
}
