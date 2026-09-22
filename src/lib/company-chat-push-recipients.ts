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
    const snap = await db.collection("users").where("companyId", "==", companyId).get();
    return snap.docs
      .filter((d) => ADMIN_ROLES.has(String(d.data()?.role ?? "").trim()))
      .map((d) => d.id)
      .filter((id) => id && id !== senderUid);
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
