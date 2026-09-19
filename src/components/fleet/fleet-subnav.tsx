"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/portal/fleet", label: "Přehled" },
  { href: "/portal/fleet/vehicles", label: "Vozidla" },
  { href: "/portal/fleet/trips", label: "Jízdy" },
  { href: "/portal/fleet/statistics", label: "Statistiky" },
];

export function FleetSubnav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b pb-2 mb-4">
      {LINKS.map((l) => {
        const active = pathname === l.href || (l.href !== "/portal/fleet" && pathname.startsWith(l.href));
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium min-h-[44px] flex items-center",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
