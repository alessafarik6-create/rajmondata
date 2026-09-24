import type { Firestore } from "firebase-admin/firestore";
import { isEmployeeActive } from "@/lib/employee-active";

const ADMIN_ROLES = new Set(["owner", "admin", "manager"]);

/** Příjemci push pro firemní chat (server-side). */
export async function resolveCompanyChatPushRecipientIds(
  db: Firestore,
  companyId: string,
  senderUid: string,
  senderRole: "employee" | "admin"
): Promise<string[]> {
  if (senderRole === "employee") {
    const rolesByUid = new Map<string, string>();
    for (const field of ["companyId", "organizationId"] as const) {
      const snap = await db.collection("users").where(field, "==", companyId).get();
      for (const d of snap.docs) {
        rolesByUid.set(d.id, String(d.data()?.role ?? "").trim());
      }
    }
    return [...rolesByUid.entries()]
      .filter(([id, role]) => id !== senderUid && ADMIN_ROLES.has(role))
      .map(([id]) => id);
  }

  const empSnap = await db.collection("companies").doc(companyId).collection("employees").get();
  const out: string[] = [];
  for (const doc of empSnap.docs) {
    const data = doc.data();
    if (!isEmployeeActive(data)) continue;
    const uid = String(data.authUserId ?? "").trim();
    if (uid && uid !== senderUid) out.push(uid);
  }
  return [...new Set(out)];
}
