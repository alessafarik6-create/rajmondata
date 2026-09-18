import { redirect } from "next/navigation";

export default function LegacyEmailsRedirect() {
  redirect("/portal/email");
}
