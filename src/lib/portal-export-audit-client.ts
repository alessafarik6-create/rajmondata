import type { User } from "firebase/auth";
import type { PortalExportAuditPayload } from "@/lib/portal-export-access";

/** Serverový audit exportů — volat po úspěšném exportu/tisku. */
export async function logPortalExportAudit(
  user: User,
  payload: PortalExportAuditPayload
): Promise<void> {
  try {
    const token = await user.getIdToken();
    await fetch("/api/company/portal-export/audit", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    /* audit nesmí blokovat export */
  }
}
