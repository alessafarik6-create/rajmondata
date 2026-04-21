/**
 * Oprávnění k záznamům ze schůzek (shodně s Firestore rules + UI na zakázce / evidenci).
 */

export type MeetingNotesProfileLike = {
  role?: string;
  globalRoles?: string[];
};

export type MeetingNotesEmployeeLike = {
  canAccessMeetingNotes?: boolean;
} | null;

export function staffCanViewMeetingRecords(
  profile: MeetingNotesProfileLike | null | undefined,
  employeeSelf: MeetingNotesEmployeeLike
): boolean {
  const role = profile?.role;
  if (
    role === "owner" ||
    role === "admin" ||
    role === "manager" ||
    role === "accountant" ||
    profile?.globalRoles?.includes("super_admin")
  ) {
    return true;
  }
  return (
    role === "employee" && employeeSelf?.canAccessMeetingNotes === true
  );
}

export function staffCanEditMeetingRecords(
  profile: MeetingNotesProfileLike | null | undefined,
  employeeSelf: MeetingNotesEmployeeLike
): boolean {
  const role = profile?.role;
  if (
    role === "owner" ||
    role === "admin" ||
    role === "manager" ||
    profile?.globalRoles?.includes("super_admin")
  ) {
    return true;
  }
  return (
    role === "employee" && employeeSelf?.canAccessMeetingNotes === true
  );
}
