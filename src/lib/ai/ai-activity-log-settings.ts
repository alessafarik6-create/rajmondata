import type { AiAssistantSettingsDoc } from "@/lib/ai/ai-settings-types";

export type AiActivityLogSettings = {
  /** Ukládat text dotazu do auditního záznamu (citlivá data). Výchozí: false. */
  storeQueryText: boolean;
  /** Doba uchovávání textu dotazu v dnech (metadata); plný purge může běžet cronem. */
  retentionDays: number;
};

export const DEFAULT_AI_ACTIVITY_LOG_SETTINGS: AiActivityLogSettings = {
  storeQueryText: false,
  retentionDays: 90,
};

export function parseAiActivityLogSettings(
  settings: Pick<AiAssistantSettingsDoc, "activityLog"> | null | undefined
): AiActivityLogSettings {
  const raw = settings?.activityLog;
  if (!raw || typeof raw !== "object") return DEFAULT_AI_ACTIVITY_LOG_SETTINGS;
  return {
    storeQueryText: raw.storeQueryText === true,
    retentionDays:
      typeof raw.retentionDays === "number" &&
      Number.isFinite(raw.retentionDays) &&
      raw.retentionDays > 0
        ? Math.min(365, Math.round(raw.retentionDays))
        : DEFAULT_AI_ACTIVITY_LOG_SETTINGS.retentionDays,
  };
}
