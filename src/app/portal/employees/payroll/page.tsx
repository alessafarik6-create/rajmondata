import { redirect } from "next/navigation";

export default function LegacyPayrollRedirectPage() {
  redirect("/portal/labor/vyplaty");
}
