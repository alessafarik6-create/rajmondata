import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";

const nav = [
  { href: "/funkce", label: "Funkce" },
  { href: "/rizeni-zakazek", label: "Zakázky" },
  { href: "/ai-pro-firmy", label: "AI" },
  { href: "/#cenik", label: "Ceník" },
];

export function PublicMarketingHeader() {
  return (
    <header className="border-b border-white/10">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4 sm:py-5 md:px-6">
        <Link href="/" className="shrink">
          <Logo context="page" compact className="max-w-[100vw]" />
        </Link>
        <nav
          className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end"
          aria-label="Hlavní navigace"
        >
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2 py-1.5 text-sm text-slate-300 hover:bg-white/5 hover:text-slate-50"
            >
              {item.label}
            </Link>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-10 w-full border border-white/10 text-slate-100 sm:h-9 sm:w-auto sm:border-0"
            asChild
          >
            <Link href="/login">Přihlásit se</Link>
          </Button>
          <Button size="sm" className="h-10 w-full sm:h-9 sm:w-auto" asChild>
            <Link href="/register">Registrovat firmu</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
