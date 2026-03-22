import { redirect } from "next/navigation";

export default function LaborVykazyRedirectPage() {
  redirect("/portal/labor/dochazka?tab=approvals");
}
