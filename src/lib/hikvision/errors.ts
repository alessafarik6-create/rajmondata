export type HikvisionErrorCode =
  | "HIKCONNECT_AUTH_FAILED"
  | "HIKCONNECT_PERMISSION_DENIED"
  | "HIKCONNECT_RATE_LIMIT"
  | "HIKCONNECT_API_ERROR"
  | "HIKCONNECT_API_NOT_CONFIGURED"
  | "DEVICE_OFFLINE"
  | "CAMERA_OFFLINE"
  | "LIVE_VIEW_NOT_SUPPORTED"
  | "PLAYBACK_NOT_SUPPORTED"
  | "INTEGRATION_NOT_CONFIGURED"
  | "ISAPI_ERROR";

const CS_MESSAGES: Record<HikvisionErrorCode, string> = {
  HIKCONNECT_AUTH_FAILED: "Přihlášení k Hik-Connect se nezdařilo. Zkontrolujte API Key a API Secret.",
  HIKCONNECT_PERMISSION_DENIED: "Hik-Connect odmítl požadavek — nedostatečná oprávnění.",
  HIKCONNECT_RATE_LIMIT: "Překročen limit Hik-Connect API. Zkuste to později.",
  HIKCONNECT_API_ERROR: "Chyba Hik-Connect API. Zkuste to znovu nebo kontaktujte podporu.",
  HIKCONNECT_API_NOT_CONFIGURED:
    "Hik-Connect OpenAPI není na serveru dokončeně nakonfigurováno (chybí oficiální specifikace nebo env).",
  DEVICE_OFFLINE: "Zařízení (NVR) je offline.",
  CAMERA_OFFLINE: "Kamera je offline.",
  LIVE_VIEW_NOT_SUPPORTED: "Živý obraz pro tento režim zatím není k dispozici.",
  PLAYBACK_NOT_SUPPORTED: "Přehrávání záznamů pro tento režim zatím není k dispozici.",
  INTEGRATION_NOT_CONFIGURED: "Integrace Hikvision není pro zvolený režim nakonfigurována.",
  ISAPI_ERROR: "Chyba přímého ISAPI připojení k NVR.",
};

export class HikvisionServiceError extends Error {
  readonly code: HikvisionErrorCode;

  constructor(code: HikvisionErrorCode, message?: string) {
    super(message ?? CS_MESSAGES[code]);
    this.name = "HikvisionServiceError";
    this.code = code;
  }

  toPublicJson() {
    return { ok: false as const, code: this.code, error: this.message };
  }
}

export function hikvisionErrorMessage(code: HikvisionErrorCode): string {
  return CS_MESSAGES[code];
}
