import { PLATFORM_NAME } from "@/lib/platform-brand";

export const HOME_SEO_TITLE =
  "RAJMONDATA | Firemní systém pro řízení zakázek s AI";

export const HOME_SEO_DESCRIPTION =
  "RAJMONDATA je podnikový informační systém s AI: zakázky, CRM, poptávky, nabídky, e-mail, dokumenty, smlouvy, fakturace, docházka, výroba, sklad, vozový park a firemní komunikace v jednom portálu.";

export const HOME_H1 =
  "RAJMONDATA – firemní systém pro řízení zakázek s podporou AI";

export const HOME_HERO_LEAD =
  "Zakázky, zaměstnanci, docházka, nabídky, fakturace, dokumenty, komunikace a AI na jednom místě — pro firmy, které vedou zakázky na míru.";

export const HOME_HERO_AI =
  "AI pomáhá rychle vytvářet nabídky, smlouvy a dodatky, hledat informace a orientovat se v celé firmě.";

export type HomeFaqItem = { question: string; answer: string };

export const HOME_FAQ: HomeFaqItem[] = [
  {
    question: "Co je RAJMONDATA?",
    answer:
      "RAJMONDATA je podnikový portál pro montážní, stavební, výrobní a řemeslné firmy. Slouží k řízení poptávek, zakázek, nabídek, zaměstnanců, docházky, dokumentů, fakturace, výroby a komunikace se zákazníky.",
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
