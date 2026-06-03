import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { VerifiedCompanyCaller } from "@/lib/api-verify-company-user";
import { callerCanAccessCompany } from "@/lib/api-verify-company-user";

export async function assertCallerCanHandoverProtocolStaff(
  db: Firestore,
  caller: VerifiedCompanyCaller,
  companyId: string,
  jobId?: string | null
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!callerCanAccessCompany(caller, companyId)) {
    return { ok: false, status: 403, error: "Nemáte přístup k této organizaci." };
  }
  if (caller.role === "customer") {
    return { ok: false, status: 403, error: "Zákaznický účet nemůže spravovat protokoly." };
  }
  if (caller.isSuperAdmin) return { ok: true };
  const role = caller.role;
  if (role === "owner" || role === "admin" || role === "manager" || role === "accountant") {
    return { ok: true };
  }
  if (role !== "employee") {
    return { ok: false, status: 403, error: "Nemáte oprávnění." };
  }
  const jid = String(jobId ?? "").trim();
  if (!jid) {
    return { ok: false, status: 403, error: "Chybí zakázka." };
  }
  const userSnap = await db.collection("users").doc(caller.uid).get();
  const uid = caller.uid;
  const membersSnap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("jobs")
    .doc(jid)
    .collection("jobMembers")
    .get();
  for (const d of membersSnap.docs) {
    const m = d.data() as Record<string, unknown>;
    if (String(m.authUserId ?? "").trim() === uid) return { ok: true };
  }
  const assigned = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("jobs")
    .doc(jid)
    .get();
  const ids = (assigned.data()?.assignedEmployeeIds ?? []) as unknown;
  if (Array.isArray(ids) && ids.some((x) => String(x) === uid)) return { ok: true };
  return { ok: false, status: 403, error: "Nemáte přístup k této zakázce." };
}

export async function assertCallerCanHandoverProtocolCustomer(
  db: Firestore,
  caller: VerifiedCompanyCaller,
  companyId: string,
  protocol: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (caller.role !== "customer" || !callerCanAccessCompany(caller, companyId)) {
    return { ok: false, status: 403, error: "Přístup odepřen." };
  }
  if (protocol.sharedWithCustomer !== true && protocol.sentToCustomer !== true) {
    return { ok: false, status: 403, error: "Protokol není sdílen se zákazníkem." };
  }
  const jid = String(protocol.jobId ?? "").trim();
  if (!jid) return { ok: false, status: 403, error: "Chybí zakázka." };
  const jobSnap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("jobs")
    .doc(jid)
    .get();
  if (!jobSnap.exists) return { ok: false, status: 404, error: "Zakázka neexistuje." };
  const linked = (jobSnap.data()?.linkedCustomerUserIds ?? []) as unknown;
  if (Array.isArray(linked) && linked.includes(caller.uid)) return { ok: true };
  const custId = String(protocol.customerId ?? "").trim();
  const userSnap = await db.collection("users").doc(caller.uid).get();
  const cr = String((userSnap.data() as { customerRecordId?: string })?.customerRecordId ?? "").trim();
  if (custId && cr && custId === cr) return { ok: true };
  return { ok: false, status: 403, error: "Nemáte přístup k tomuto protokolu." };
}
