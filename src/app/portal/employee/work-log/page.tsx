import { redirect } from "next/navigation";

/**
 * Zastaralá cesta — kanonická route je /portal/employee/worklogs
 */
export default function EmployeeWorkLogLegacyRedirect() {
  redirect("/portal/employee/worklogs");
}
