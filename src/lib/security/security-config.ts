export const SECURITY_THRESHOLDS = {
  /** Neúspěšná přihlášení superadmina v okně → incident. */
  superadminFailedLogin: { count: 8, windowMs: 15 * 60 * 1000, severity: "HIGH" as const },
  /** Obecné 401/403 burst na citlivých route. */
  authFailureBurst: { count: 25, windowMs: 10 * 60 * 1000, severity: "HIGH" as const },
  /** 404 scan pattern. */
  notFoundScan: { count: 40, windowMs: 10 * 60 * 1000, severity: "MEDIUM" as const },
  /** Analytics collect spam. */
  analyticsCollect: { count: 120, windowMs: 60 * 60 * 1000, severity: "LOW" as const },
  /** Registrace / reset hesla. */
  registerAttempts: { count: 10, windowMs: 60 * 60 * 1000, severity: "MEDIUM" as const },
};

export const SECURITY_RETENTION_DAYS = Number(process.env.SECURITY_INCIDENT_RETENTION_DAYS || 90);
export const SECURITY_ALERT_EMAIL_COOLDOWN_MS = Number(
  process.env.SECURITY_ALERT_EMAIL_COOLDOWN_MS || 30 * 60 * 1000
);

export type SecuritySeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type SecurityCategory =
  | "PUBLIC_TRAFFIC"
  | "AUTH_SECURITY"
  | "PORTAL_SECURITY"
  | "ADMIN_SECURITY"
  | "API_SECURITY"
  | "UPLOAD_SECURITY"
  | "AI_SECURITY";
