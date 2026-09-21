/** Client-safe typy a výchozí hodnoty — bez firebase-admin. */

export const PLATFORM_AI_BRANDING_DOC = "aiAssistant";

export type PlatformAiBranding = {
  assistantName: string;
  assistantSubtitle: string;
  avatarUrl: string | null;
  avatarStoragePath: string | null;
  updatedAt?: unknown;
  updatedBy?: string | null;
};

export const DEFAULT_PLATFORM_AI_BRANDING: PlatformAiBranding = {
  assistantName: "RAJMONDATA AI",
  assistantSubtitle: "Vaše firemní sekretářka",
  avatarUrl: null,
  avatarStoragePath: null,
};
