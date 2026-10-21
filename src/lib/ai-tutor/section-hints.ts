/** Kontextová nápověda podle cesty portálu (bez citlivých dat). */
export function aiTutorSectionHint(pathname: string): { title: string; prompt: string } | null {
  const p = pathname || "";
  if (p.startsWith("/portal/jobs")) {
    return {
      title: "Zakázky",
      prompt: "Chcete vytvořit novou zakázku, smlouvu o dílo nebo odeslat dokument zákazníkovi?",
    };
  }
  if (p.startsWith("/portal/customers")) {
    return { title: "Zákazníci", prompt: "Pomohu vám založit zákazníka nebo propojit ho se zakázkou." };
  }
  if (p.startsWith("/portal/employees")) {
    return { title: "Zaměstnanci", prompt: "Ukážu přidání zaměstnance a nastavení rolí a oprávnění." };
  }
  if (p.startsWith("/portal/invoices")) {
    return { title: "Fakturace", prompt: "Můžeme vystavit zálohovou fakturu nebo běžnou fakturu ze zakázky." };
  }
  if (p.startsWith("/portal/email") || p.startsWith("/portal/emails")) {
    return { title: "E-mail", prompt: "Pomohu připojit firemní schránku nebo odesílat dokumenty ze zakázky." };
  }
  if (p.startsWith("/portal/labor")) {
    return { title: "Docházka", prompt: "Chcete nastavit první docházkový terminál nebo přehled výkazů?" };
  }
  if (p.startsWith("/portal/sklad")) {
    return { title: "Sklad", prompt: "Ukážu naskladnění materiálu nebo založení skladové položky." };
  }
  if (p.startsWith("/portal/fleet")) {
    return { title: "Vozový park", prompt: "Můžeme propojit GPS SatelitníSledování.cz a sledovat vozidla na mapě." };
  }
  if (p.startsWith("/portal/schedule")) {
    return { title: "Kalendář", prompt: "Naplánujeme montáže, schůzky nebo kapacity týmu." };
  }
  if (p.startsWith("/portal/ai-center") || p.includes("secretary")) {
    return { title: "AI", prompt: "Zde najdete AI sekretářku a další nástroje — zeptejte se na konkrétní úkol." };
  }
  if (p.startsWith("/portal/dashboard")) {
    return {
      title: "Přehled",
      prompt: "Zkontrolujte doporučený další krok nastavení firmy nebo spusťte průvodce.",
    };
  }
  return null;
}
