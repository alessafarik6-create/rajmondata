import { redirect } from "next/navigation";

/** Přesměrování staré URL — veřejná docházka je na /attendance-login (s companyId z portálu). */
export default function MobileTerminalRedirectPage() {
  redirect("/portal/labor/dochazka");
}
