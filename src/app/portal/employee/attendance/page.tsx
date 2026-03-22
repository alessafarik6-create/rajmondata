import { redirect } from "next/navigation";

/** Jednotná docházka v portálu — sekce Práce a mzdy. */
export default function EmployeeAttendanceAliasPage() {
  redirect("/portal/labor/dochazka");
}
