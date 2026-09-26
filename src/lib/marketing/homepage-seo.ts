import { PLATFORM_NAME } from "@/lib/platform-brand";

export const HOME_SEO_TITLE =
  "RAJMONDATA | CRM a ERP systém pro řízení firmy s AI";

export const HOME_SEO_DESCRIPTION =
  "RAJMONDATA je český CRM a ERP firemní systém pro řízení zakázek, zákazníků, zaměstnanců, docházky, nabídek, fakturace, výroby a firemní komunikace s podporou AI.";

export const HOME_H1 = "CRM a ERP systém pro řízení celé firmy s podporou AI";

export const HOME_HERO_LEAD =
  "RAJMONDATA propojuje CRM, řízení zakázek, zaměstnance, docházku, nabídky, fakturaci, dokumenty, sklad, výrobu a firemní komunikaci do jednoho online systému — pro firmy, které chtějí mít provoz pod kontrolou bez roztříštěných tabulek.";

export const HOME_HERO_AI =
  "AI pomáhá zpracovávat e-maily, vytvářet cenové nabídky, smlouvy a další firemní dokumenty. Návrhy vždy kontrolujete před odesláním zákazníkovi nebo uložením do zakázky.";

export type HomeFaqItem = { question: string; answer: string };

export const HOME_FAQ: HomeFaqItem[] = [
  {
    question: "Co je RAJMONDATA?",
    answer:
      "RAJMONDATA je podnikový portál pro montážní, stavební, výrobní a řemeslné firmy. Slouží k řízení poptávek, zakázek, nabídek, zaměstnanců, docházky, dokumentů, fakturace, výroby a komunikace se zákazníky.",
  },
  {
    question: "Jaký je rozdíl mezi CRM a ERP v RAJMONDATA?",
    answer:
      "CRM pokrývá zákazníky, poptávky, nabídky a obchodní komunikaci. ERP vrstva v portálu zahrnuje realizaci zakázek, zaměstnance, docházku, výrobu, sklad, fakturaci a reporting — vše propojené v jednom systému.",
  },
  {
    question: "Pro jaké firmy je RAJMONDATA vhodná?",
    answer:
      "Pro menší a střední firmy, které vedou zakázky na míru — montáže, pergoly, zimní zahrady, zasklení, servis, výroba na zakázku i stavební práce.",
  },
  {
    question: "Umí RAJMONDATA řídit zakázky?",
    answer:
      "Ano. Od poptávky a nabídky přes zaměření, úkoly, fotodokumentaci, rozpočet, vícepráce a fakturaci až po předání zákazníkovi.",
  },
  {
    question: "Umí přijímat poptávky z webu?",
    answer:
      "Ano. Poptávky z vašeho webu lze integrovat do portálu, přiřadit obchodníkovi a převést na nabídku nebo zakázku.",
  },
  {
    question: "Umí vytvářet nabídky pomocí AI?",
    answer:
      "Ano. AI vychází z údajů poptávky, ceníků a firemních pravidel a připraví návrh nabídky k vaší kontrole a úpravě.",
  },
  {
    question: "Umí AI vytvářet smlouvy a dodatky?",
    answer:
      "Ano. Na základě zakázky a zadání připraví návrh textu smlouvy nebo dodatku. Finální dokument vždy schvaluje uživatel.",
  },
  {
    question: "Má RAJMONDATA docházku zaměstnanců?",
    answer:
      "Ano. Docházka, výkazy, sazby a přehled práce jsou propojené se zakázkami a zaměstnanci.",
  },
  {
    question: "Lze docházku používat na tabletu?",
    answer:
      "Ano. Docházkový terminál běží na externím tabletu — zaměstnanec se přihlásí PINem a zaznamená příchod nebo odchod.",
  },
  {
    question: "Má zákaznický portál?",
    answer:
      "Ano. Zákazník může vidět průběh zakázky, vybrané fotografie, dokumenty a komunikovat s firmou.",
  },
  {
    question: "Umí fakturaci a zálohy?",
    answer:
      "Ano. Položkový rozpočet, vícepráce, zálohy, zálohové i konečné faktury a přehled zbývající částky včetně DPH.",
  },
  {
    question: "Lze řídit výrobu a sklad?",
    answer:
      "Ano. Výroba, materiál, skladové pohyby a spotřeba jsou navázané na konkrétní zakázky.",
  },
  {
    question: "Funguje na telefonu?",
    answer:
      "Ano. Portál je webová aplikace — funguje v prohlížeči na počítači, tabletu i mobilu.",
  },
];

export function buildHomeJsonLd(siteUrl: string) {
  const orgId = `${siteUrl}/#organization`;
  const appId = `${siteUrl}/#software`;

  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      name: PLATFORM_NAME,
      url: siteUrl,
      description: HOME_SEO_DESCRIPTION,
      publisher: { "@id": orgId },
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": orgId,
      name: PLATFORM_NAME,
      url: siteUrl,
      logo: `${siteUrl}/pwa-512.png`,
      description: HOME_SEO_DESCRIPTION,
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "@id": appId,
      name: PLATFORM_NAME,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: siteUrl,
      description: HOME_SEO_DESCRIPTION,
      publisher: { "@id": orgId },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: HOME_FAQ.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    },
  ];
}
