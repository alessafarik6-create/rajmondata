import Link from "next/link";
import { PLATFORM_NAME } from "@/lib/platform-brand";

const productLinks = [
  { href: "/rizeni-zakazek", label: "Řízení zakázek" },
  { href: "/ai-pro-firmy", label: "AI pro firmy" },
  { href: "/dochazka-zamestnancu", label: "Docházka" },
  { href: "/poptavky-a-nabidky", label: "Poptávky a nabídky" },
  { href: "/email-pro-firmy", label: "E-mail" },
  { href: "/fakturace-a-doklady", label: "Fakturace" },
  { href: "/rizeni-vyroby", label: "Výroba" },
  { href: "/skladove-hospodarstvi", label: "Sklad" },
  { href: "/vozovy-park", label: "Vozový park" },
];

const solutionLinks = [
  { href: "/pro-remeslniky", label: "Pro řemeslníky" },
  { href: "/pro-montazni-firmy", label: "Pro montážní firmy" },
];

const rajmondataLinks = [
  { href: "/funkce", label: "Ceník a funkce" },
  { href: "/#kontakt", label: "Kontakt" },
  { href: "/login", label: "Přihlášení" },
  { href: "/register", label: "Vyzkoušet zdarma" },
];

const legalLinks = [
  { href: "/obchodni-podminky", label: "Obchodní podmínky" },
  { href: "/ochrana-osobnich-udaju", label: "Ochrana osobních údajů" },
  { href: "/cookies", label: "Cookies" },
];

export function PublicMarketingFooter({ contactEmail }: { contactEmail?: string | null }) {
  return (
    <footer className="border-t border-white/10 bg-slate-950/80 py-10 text-sm text-slate-400">
      <div className="mx-auto grid max-w-6xl gap-8 px-3 sm:grid-cols-2 sm:px-4 lg:grid-cols-4 md:px-6">
        <div>
          <p className="text-base font-semibold text-slate-100">{PLATFORM_NAME}</p>
          <p className="mt-2 text-xs leading-relaxed">
            Firemní portál a CRM pro řízení zakázek, zaměstnanců, docházky a fakturace s podporou AI.
          </p>
        </div>
        <div>
          <p className="font-medium text-slate-200">Produkt</p>
          <ul className="mt-3 space-y-2">
            {productLinks.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-primary hover:underline underline-offset-2">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-medium text-slate-200">Pro firmy</p>
          <ul className="mt-3 space-y-2">
            {solutionLinks.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-primary hover:underline underline-offset-2">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-medium text-slate-200">RAJMONDATA</p>
          <ul className="mt-3 space-y-2">
            {rajmondataLinks.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-primary hover:underline underline-offset-2">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 font-medium text-slate-200">Právní</p>
          <ul className="mt-3 space-y-2">
            {legalLinks.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-primary hover:underline underline-offset-2">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          {contactEmail ? (
            <p className="mt-4 text-xs">
              Kontakt:{" "}
              <a href={`mailto:${contactEmail}`} className="text-slate-300 hover:text-primary">
                {contactEmail}
              </a>
            </p>
          ) : null}
        </div>
      </div>
      <p className="mx-auto mt-8 max-w-6xl px-3 text-center text-xs text-slate-500 md:px-6">
        © {new Date().getFullYear()} {PLATFORM_NAME}.{" "}
        <Link href="/login" className="hover:text-slate-400 hover:underline">
          Přihlášení
        </Link>
        {" · "}
        <Link href="/register" className="hover:text-slate-400 hover:underline">
          Registrace firmy
        </Link>
      </p>
    </footer>
  );
}
