import { formatPortalEmployeeListName, isEmployeeActive } from "@/lib/employee-active";
import { displayNameFromUserRecord, chatRoleLabelCs } from "@/lib/chat-participant-profile";

export const ORG_TASK_REF_USER_PREFIX = "user:";
export const ORG_TASK_REF_EMP_PREFIX = "emp:";

export type OrgTaskAssigneeOption = {
  /** Uložená reference (`user:…` / `emp:…`). */
  ref: string;
  userId: string | null;
  employeeId: string | null;
  label: string;
  roleLabel: string;
  searchText: string;
};

export function encodeOrgTaskAssigneeRef(input: {
  userId?: string | null;
  employeeId?: string | null;
}): string {
  const uid = String(input.userId ?? "").trim();
  const eid = String(input.employeeId ?? "").trim();
  if (uid) return `${ORG_TASK_REF_USER_PREFIX}${uid}`;
  if (eid) return `${ORG_TASK_REF_EMP_PREFIX}${eid}`;
  return "";
}

export function parseOrgTaskAssigneeRef(ref: string | null | undefined): {
  userId: string | null;
  employeeId: string | null;
  legacyEmployeeId: string | null;
} {
  const s = String(ref ?? "").trim();
  if (!s) {
    return { userId: null, employeeId: null, legacyEmployeeId: null };
  }
  if (s.startsWith(ORG_TASK_REF_USER_PREFIX)) {
    return {
      userId: s.slice(ORG_TASK_REF_USER_PREFIX.length),
      employeeId: null,
      legacyEmployeeId: null,
    };
  }
  if (s.startsWith(ORG_TASK_REF_EMP_PREFIX)) {
    return {
      userId: null,
      employeeId: s.slice(ORG_TASK_REF_EMP_PREFIX.length),
      legacyEmployeeId: null,
    };
  }
  return { userId: null, employeeId: null, legacyEmployeeId: s };
}

function orgTaskRoleLabelForUser(
  roleRaw: string | undefined,
  userId: string,
  companyOwnerUid: string | null | undefined
): string {
  if (companyOwnerUid && userId === companyOwnerUid) return "Vlastník organizace";
  const r = String(roleRaw ?? "").trim().toLowerCase();
  if (r === "owner") return "Vlastník organizace";
  return chatRoleLabelCs(r || "employee") || "Uživatel";
}

type UserRow = Record<string, unknown> & { id?: string };
type EmployeeRow = Record<string, unknown> & { id?: string; authUserId?: string };

/**
 * Aktivní členové organizace pro přiřazení úkolů — deduplikace podle Firebase Auth uid.
 */
export function buildOrgTaskAssigneeOptions(input: {
  users: readonly UserRow[];
  employees: readonly EmployeeRow[];
  companyOwnerUid?: string | null;
  /** Již uložené reference (neaktivní / historické). */
  alsoIncludeRefs?: Iterable<string | null | undefined>;
}): OrgTaskAssigneeOption[] {
  const ownerUid = String(input.companyOwnerUid ?? "").trim() || null;
  const extraRefs = new Set<string>();
  for (const raw of input.alsoIncludeRefs ?? []) {
    const r = String(raw ?? "").trim();
    if (r) extraRefs.add(r);
  }

  const employeeById = new Map<string, EmployeeRow>();
  const employeeByUserId = new Map<string, EmployeeRow>();
  for (const e of input.employees) {
    const id = String(e.id ?? "").trim();
    if (id) employeeById.set(id, e);
    const uid = String(e.authUserId ?? "").trim();
    if (uid) employeeByUserId.set(uid, e);
  }

  const byUserId = new Map<string, OrgTaskAssigneeOption>();

  const upsert = (opt: OrgTaskAssigneeOption) => {
    const uid = opt.userId;
    if (uid) {
      const prev = byUserId.get(uid);
      if (!prev || opt.label.length > prev.label.length) byUserId.set(uid, opt);
      return;
    }
    byUserId.set(`__emp__${opt.ref}`, opt);
  };

  for (const u of input.users) {
    const userId = String(u.id ?? "").trim();
    if (!userId) continue;
    const status = String(u.status ?? u.accountStatus ?? "").trim().toLowerCase();
    if (status === "disabled" || status === "inactive") continue;

    const emp = employeeByUserId.get(userId);
    const empActive = emp ? isEmployeeActive(emp) : true;
    if (emp && !empActive) {
      const ref = encodeOrgTaskAssigneeRef({ userId, employeeId: String(emp.id ?? "") });
      if (!extraRefs.has(ref) && !extraRefs.has(encodeOrgTaskAssigneeRef({ userId }))) continue;
    }

    const nameFromUser = displayNameFromUserRecord(u);
    const nameFromEmp = emp ? formatPortalEmployeeListName(emp, String(emp.id ?? "")) : "";
    const name =
      (nameFromUser && nameFromUser !== "Uživatel" ? nameFromUser : "") ||
      nameFromEmp ||
      nameFromUser ||
      userId.slice(0, 8);

    const roleLabel = orgTaskRoleLabelForUser(
      String(u.role ?? emp?.role ?? ""),
      userId,
      ownerUid
    );
    const ref = encodeOrgTaskAssigneeRef({
      userId,
      employeeId: emp ? String(emp.id ?? "") : null,
    });
    upsert({
      ref,
      userId,
      employeeId: emp ? String(emp.id ?? "").trim() || null : null,
      label: `${name} – ${roleLabel}`,
      roleLabel,
      searchText: `${name} ${roleLabel} ${String(u.email ?? "")}`.toLowerCase(),
    });
  }

  for (const e of input.employees) {
    const empId = String(e.id ?? "").trim();
    if (!empId) continue;
    const uid = String(e.authUserId ?? "").trim();
    if (uid && byUserId.has(uid)) continue;
    const active = isEmployeeActive(e);
    const ref = encodeOrgTaskAssigneeRef({ employeeId: empId });
    if (!active && !extraRefs.has(ref)) continue;
    const name = formatPortalEmployeeListName(e, empId);
    const roleLabel = chatRoleLabelCs(String(e.role ?? "employee")) || "Zaměstnanec";
    upsert({
      ref,
      userId: uid || null,
      employeeId: empId,
      label: `${name} – ${roleLabel}`,
      roleLabel,
      searchText: `${name} ${roleLabel}`.toLowerCase(),
    });
  }

  for (const ref of extraRefs) {
    const parsed = parseOrgTaskAssigneeRef(ref);
    if (parsed.userId && byUserId.has(parsed.userId)) continue;
    if (parsed.employeeId && [...byUserId.values()].some((o) => o.employeeId === parsed.employeeId)) {
      continue;
    }
    let label = ref;
    if (parsed.userId) {
      const u = input.users.find((x) => String(x.id) === parsed.userId);
      const emp = parsed.employeeId
        ? employeeById.get(parsed.employeeId)
        : employeeByUserId.get(parsed.userId);
      const name = u
        ? displayNameFromUserRecord(u)
        : emp
          ? formatPortalEmployeeListName(emp, parsed.employeeId ?? undefined)
          : parsed.userId.slice(0, 8);
      const roleLabel = orgTaskRoleLabelForUser(
        String(u?.role ?? emp?.role ?? ""),
        parsed.userId,
        ownerUid
      );
      label = `${name} – ${roleLabel}`;
      upsert({
        ref,
        userId: parsed.userId,
        employeeId: parsed.employeeId ?? (emp ? String(emp.id ?? "") : null),
        label,
        roleLabel,
        searchText: label.toLowerCase(),
      });
    } else if (parsed.employeeId || parsed.legacyEmployeeId) {
      const eid = parsed.employeeId ?? parsed.legacyEmployeeId!;
      const emp = employeeById.get(eid);
      const name = emp ? formatPortalEmployeeListName(emp, eid) : eid.slice(0, 8);
      const roleLabel = chatRoleLabelCs(String(emp?.role ?? "employee")) || "Zaměstnanec";
      label = `${name} – ${roleLabel}`;
      upsert({
        ref: parsed.employeeId ? ref : encodeOrgTaskAssigneeRef({ employeeId: eid }),
        userId: null,
        employeeId: eid,
        label,
        roleLabel,
        searchText: label.toLowerCase(),
      });
    }
  }

  const list = [...byUserId.values()];
  list.sort((a, b) =>
    a.label.localeCompare(b.label, "cs", { sensitivity: "base" })
  );
  return list;
}

export function resolveOrgTaskAssigneeLabel(
  ref: string | null | undefined,
  options: readonly OrgTaskAssigneeOption[],
  fallbackEmployeeNames?: Map<string, string>
): string {
  const s = String(ref ?? "").trim();
  if (!s) return "—";
  const hit = options.find((o) => o.ref === s);
  if (hit) return hit.label.split(" – ")[0] ?? hit.label;
  const parsed = parseOrgTaskAssigneeRef(s);
  if (parsed.legacyEmployeeId && fallbackEmployeeNames?.has(parsed.legacyEmployeeId)) {
    return fallbackEmployeeNames.get(parsed.legacyEmployeeId)!;
  }
  if (parsed.employeeId && fallbackEmployeeNames?.has(parsed.employeeId)) {
    return fallbackEmployeeNames.get(parsed.employeeId)!;
  }
  return s;
}
