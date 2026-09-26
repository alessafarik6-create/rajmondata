/** Poslední významná úprava obsahu (ISO) — pro sitemap lastModified. */
const PAGE_LAST_MOD: Record<string, string> = {
  home: "2026-09-26",
  crm: "2026-09-26",
  "erp-system": "2026-09-26",
  "crm-zdarma": "2026-09-26",
  funkce: "2026-03-26",
  "rizeni-zakazek": "2026-03-26",
  "dochazka-zamestnancu": "2026-03-26",
  "prace-a-mzdy": "2026-03-26",
  "poptavky-a-nabidky": "2026-03-26",
  "ai-pro-firmy": "2026-03-26",
  "ai-smlouvy-a-dodatky": "2026-03-26",
  "fakturace-a-doklady": "2026-03-26",
  "komunikace-se-zakazniky": "2026-03-26",
  "sklad-a-vyroba": "2026-03-26",
  "email-pro-firmy": "2026-03-26",
  "vozovy-park": "2026-03-26",
  "rizeni-vyroby": "2026-03-26",
  "skladove-hospodarstvi": "2026-03-26",
  "firemni-portal": "2026-03-26",
  "kamerovy-system": "2026-03-26",
  "pro-remeslniky": "2026-03-26",
  "pro-montazni-firmy": "2026-03-26",
  "pro-stavebni-firmy": "2026-03-26",
  "obchodni-podminky": "2025-06-01",
  "ochrana-osobnich-udaju": "2025-06-01",
  cookies: "2025-06-01",
};

export function lastModifiedForMarketingSlug(slug: string): Date {
  const iso = PAGE_LAST_MOD[slug] ?? PAGE_LAST_MOD.home;
  return new Date(`${iso}T12:00:00.000Z`);
}

export function lastModifiedForHome(): Date {
  return new Date(`${PAGE_LAST_MOD.home}T12:00:00.000Z`);
}
