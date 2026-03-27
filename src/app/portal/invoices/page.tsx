import { redirect } from "next/navigation";

/** Seznam faktur je sjednocen v sekci Doklady (vydané doklady). */
export default function InvoicesIndexRedirect() {
  redirect("/portal/documents?view=issued");
}
