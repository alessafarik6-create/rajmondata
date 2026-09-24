import type { Firestore } from "firebase-admin/firestore";
import { isEmployeeActive } from "@/lib/employee-active";

/** Interní role, které smí používat firemní chat. */
export const CHAT_INTERNAL_ROLES = new Set([
  "owner",
  "admin",
  "manager",
  "accountant",
  "employee",
]);

export type ChatParticipantProfile = {
  userId: string;
  displayName: string;
  role: string;
  roleLabel: string;
  photoUrl: string;
  employeeId: string | null;
  email: string;
};

export function chatRoleLabelCs(role: string): string {
  const r = String(role ?? "").trim().toLowerCase();
  if (r === "owner") return "Vlastník";
  if (r === "admin") return "Administrátor";
  if (r === "manager") return "Manažer";
  if (r === "accountant") return "Účetní";
  if (r === "employee") return "Zaměstnanec";
  if (!r) return "";
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Preferuje displayName, jméno, e-mail. */
export function displayNameFromUserRecord(data: Record<string, unknown>): string {
  const displayName = trimStr(data.displayName);
  if (displayName) return displayName;
  const fn = trimStr(data.firstName);
  const ln = trimStr(data.lastName);
  const full = `${fn} ${ln}`.trim();
  if (full) return full;
  const name = trimStr(data.name);
  if (name) return name;
  const email = trimStr(data.email);
  if (email) return email.split("@")[0] || email;
  return "";
}

export function displayNameFromEmployeeRecord(data: Record<string, unknown>): string {
  const fn = trimStr(data.firstName);
  const ln = trimStr(data.lastName);
  const full = `${fn} ${ln}`.trim();
  if (full) return full;
  const email = trimStr(data.email);
  if (email) return email.split("@")[0] || email;
  return "";
}

function photoFromRecords(
  user: Record<string, unknown>,
  emp?: Record<string, unknown>
): string {
  return (
    trimStr(user.profileImage) ||
    trimStr(user.photoURL) ||
    trimStr(user.photoUrl) ||
    (emp ? trimStr(emp.profileImage) || trimStr(emp.photoURL) : "") ||
    ""
  );
}

function mergeParticipant(
  userId: string,
  userData: Record<string, unknown>,
  employeeByUid: Map<string, Record<string, unknown> & { id: string }>
): ChatParticipantProfile | null {
  const role = trimStr(userData.role).toLowerCase() || "employee";
  if (!CHAT_INTERNAL_ROLES.has(role)) return null;

  const emp = employeeByUid.get(userId);
  const displayName =
    displayNameFromUserRecord(userData) ||
    (emp ? displayNameFromEmployeeRecord(emp) : "") ||
    trimStr(userData.email).split("@")[0] ||
    "Uživatel";

  const employeeId =
    trimStr(userData.employeeId) ||
    (emp?.id ? String(emp.id) : "") ||
    null;

  return {
    userId,
    displayName,
    role,
    roleLabel: chatRoleLabelCs(role),
    photoUrl: photoFromRecords(userData, emp),
    employeeId,
    email: trimStr(userData.email),
  };
}

/** Všichni interní chat uživatelé organizace (deduplikace podle auth uid). */
export async function loadCompanyChatContacts(
  db: Firestore,
  companyId: string,
  excludeUserId?: string | null
): Promise<ChatParticipantProfile[]> {
  const orgId = String(companyId || "").trim();
  if (!orgId) return [];

  const userDocs = new Map<string, Record<string, unknown>>();
  for (const field of ["companyId", "organizationId"] as const) {
    const snap = await db.collection("users").where(field, "==", orgId).get();
    for (const d of snap.docs) {
      if (!userDocs.has(d.id)) userDocs.set(d.id, d.data() as Record<string, unknown>);
    }
  }

  const empSnap = await db.collection("companies").doc(orgId).collection("employees").get();
  const employeeByUid = new Map<string, Record<string, unknown> & { id: string }>();
  for (const d of empSnap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (!isEmployeeActive(data)) continue;
    const uid = trimStr(data.authUserId);
    if (uid) employeeByUid.set(uid, { ...data, id: d.id });
  }

  const out = new Map<string, ChatParticipantProfile>();
  for (const [uid, userData] of userDocs) {
    if (excludeUserId && uid === excludeUserId) continue;
    const p = mergeParticipant(uid, userData, employeeByUid);
    if (p) out.set(uid, p);
  }

  return [...out.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, "cs")
  );
}

export type ChatParticipantResolveContext = {
  currentUserId?: string;
  profile: Record<string, unknown> | null | undefined;
  participantsByUserId: Map<string, ChatParticipantProfile>;
  employeesById: Map<string, Record<string, unknown>>;
  employeesByAuthUid: Map<string, Record<string, unknown>>;
};

export function resolveChatSenderDisplay(
  m: {
    senderId?: string;
    senderName?: string;
    senderPhotoURL?: string;
    senderRole?: string;
    employeeId?: string;
    createdByRole?: string;
    authorRole?: string;
  },
  ctx: ChatParticipantResolveContext
): { name: string; photo: string; roleLabel: string | null } {
  const senderId = trimStr(m.senderId);
  const nameStored = trimStr(m.senderName);
  const photoStored = trimStr(m.senderPhotoURL);

  if (senderId && senderId === ctx.currentUserId) {
    const fromProfile = displayNameFromUserRecord(ctx.profile ?? {}) || nameStored;
    const photo = photoFromRecords(ctx.profile ?? {}, undefined) || photoStored;
    return { name: fromProfile || "Já", photo, roleLabel: null };
  }

  const orgUser = senderId ? ctx.participantsByUserId.get(senderId) : undefined;
  if (orgUser) {
    return {
      name: orgUser.displayName,
      photo: orgUser.photoUrl || photoStored,
      roleLabel: orgUser.roleLabel,
    };
  }

  const emp =
    (m.employeeId ? ctx.employeesById.get(m.employeeId) : undefined) ??
    (senderId ? ctx.employeesByAuthUid.get(senderId) : undefined);
  if (emp) {
    const name = displayNameFromEmployeeRecord(emp) || nameStored;
    const roleRaw =
      trimStr(m.createdByRole) ||
      trimStr(m.authorRole) ||
      trimStr(m.senderRole) ||
      "employee";
    return {
      name: name || trimStr(emp.email).split("@")[0] || "Uživatel",
      photo: photoFromRecords({}, emp) || photoStored,
      roleLabel: chatRoleLabelCs(roleRaw === "admin" ? "employee" : roleRaw),
    };
  }

  if (nameStored) {
    const roleRaw =
      trimStr(m.createdByRole) ||
      trimStr(m.authorRole) ||
      (m.senderRole === "admin" ? "admin" : m.senderRole === "employee" ? "employee" : "");
    const roleLabel = roleRaw ? chatRoleLabelCs(roleRaw) : null;
    return { name: nameStored, photo: photoStored, roleLabel };
  }

  if (senderId && ctx.participantsByUserId.size === 0) {
    return { name: "Uživatel", photo: photoStored, roleLabel: null };
  }

  return {
    name: nameStored || (senderId ? "Uživatel" : "—"),
    photo: photoStored,
    roleLabel: null,
  };
}
