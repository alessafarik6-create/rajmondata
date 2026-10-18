import type { OrgCampaignType } from "@/lib/platform-org-campaigns/types";

export type OrgCampaignPreset = {
  id: string;
  label: string;
  type: OrgCampaignType;
  title: string;
  shortDescription: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  emailSubject: string;
  consultationEnabled: boolean;
};

const PORTAL = "https://rajmondata.cz/portal/dashboard";
const CONSULT = "https://rajmondata.cz/rezervace-konzultace";

export const ORG_CAMPAIGN_PRESETS: OrgCampaignPreset[] = [
  {
    id: "return-help-a",
    label: "A – Potřebujete pomoci s RAJMONDATA?",
    type: "support",
    title: "Využíváte všechny možnosti RAJMONDATA?",
    shortDescription:
      "RAJMONDATA vám může usnadnit správu zakázek, fakturaci, docházku i dokumentů.",
    bodyHtml: `<p>RAJMONDATA vám může usnadnit správu zakázek, fakturaci, docházku zaměstnanců, evidenci dokumentů i každodenní řízení firmy.</p>
<p>Rádi vám <strong>zdarma</strong> ukážeme, jak portál nastavit a používat naplno.</p>`,
    ctaLabel: "Domluvit konzultaci",
    ctaUrl: CONSULT,
    emailSubject: "RAJMONDATA – využíváte všechny možnosti portálu?",
    consultationEnabled: true,
  },
  {
    id: "return-portal-b",
    label: "B – Vraťte se do svého firemního portálu",
    type: "message",
    title: "Vaše firma může fungovat jednodušeji",
    shortDescription: "Váš firemní portál RAJMONDATA je připraven pomoci s organizací zakázek a financí.",
    bodyHtml: `<p>Váš firemní portál RAJMONDATA je připraven pomoci vám s organizací zakázek, zaměstnanců, financí a komunikace.</p>
<p>Nevíte, kde začít? Domluvte si krátkou konzultaci a vše vám ukážeme.</p>`,
    ctaLabel: "Přejít do portálu",
    ctaUrl: PORTAL,
    emailSubject: "RAJMONDATA – váš firemní portál na vás čeká",
    consultationEnabled: true,
  },
  {
    id: "discover-features-c",
    label: "C – Objevte další funkce",
    type: "news",
    title: "Objevte, co všechno RAJMONDATA umí",
    shortDescription: "CRM, zakázky, fakturace, GPS, docházka, AI sekretářka a další moduly.",
    bodyHtml: `<p>RAJMONDATA nabízí moduly podle potřeb vaší firmy:</p>
<ul>
<li>CRM a správa zákazníků</li>
<li>Zakázky a projekty</li>
<li>Fakturace a dokumenty</li>
<li>GPS sledování vozidel</li>
<li>Docházka zaměstnanců</li>
<li>AI sekretářka</li>
<li>Firemní e-mail a komunikace</li>
</ul>
<p>Některé funkce mohou být součástí doplňkových modulů — rádi vám je představíme na konzultaci.</p>`,
    ctaLabel: "Domluvit ukázku",
    ctaUrl: CONSULT,
    emailSubject: "RAJMONDATA – objevte další možnosti portálu",
    consultationEnabled: true,
  },
];
