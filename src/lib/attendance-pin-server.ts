/**
 * Ověření docházkového PINu na serveru (bez Firebase Auth na klientovi).
 * Kanonicky: hash v `private/terminal`, legacy: pole `attendancePin` na zaměstnanci.
 */
import type { Firestore } from "firebase-admin/firestore";
import { verifyTerminalPinHash } from "@/lib/terminal-pin-crypto";
import { normalizeTerminalPin } from "@/lib/terminal-pin-validation";
import { isVisibleInAttendanceTerminal } from "@/lib/employee-organization";

export function privateAttendancePinRef(db: Firestore, companyId: string, employeeId: string) {
  return db
    .collection("companies")
    .doc(companyId)
    .collection("employees")
    .doc(employeeId)
    .collection("private")
    .doc("terminal");
}

function readStoredPinHash(privateData: Record<string, unknown> | undefined): string {
  if (!privateData) return "";
  const h =
    (privateData.terminalPinHash as string | undefined) ??
    (privateData.pinHash as string | undefined);
  return typeof h === "string" && h.length > 0 ? h : "";
}

/**
 * Ověří PIN vůči jednomu zaměstnanci (hash nebo legacy attendancePin).
 */
export async function verifyAttendancePinForEmployee(
  db: Firestore,
  companyId: string,
  employeeId: string,
  pinNormalized: string
): Promise<boolean> {
  const empRef = db.collection("companies").doc(companyId).collection("employees").doc(employeeId);
  const empSnap = await empRef.get();
  if (!empSnap.exists) return false;
  const data = empSnap.data() as Record<string, unknown>;
  if (data.isActive === false) return false;
  if (!isVisibleInAttendanceTerminal(data)) return false;

  const privateSnap = await privateAttendancePinRef(db, companyId, employeeId).get();
  const privateData = privateSnap.exists
    ? (privateSnap.data() as Record<string, unknown>)
    : undefined;
  const hash = readStoredPinHash(privateData);

  if (hash.length > 0) {
    return verifyTerminalPinHash(pinNormalized, hash);
  }

  const legacyRaw = data.attendancePin;
  const legacy =
    legacyRaw != null && legacyRaw !== "" ? normalizeTerminalPin(String(legacyRaw)) : "";
  return legacy.length > 0 && legacy === pinNormalized;
}
