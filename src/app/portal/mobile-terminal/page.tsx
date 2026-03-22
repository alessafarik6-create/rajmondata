import { redirect } from "next/navigation";

/** Alias URL — stejný obsah jako /portal/attendance/terminal */
export default function MobileTerminalAliasPage() {
  redirect("/portal/attendance/terminal");
}
