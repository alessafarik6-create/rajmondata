import type { HomeFaqItem } from "@/lib/marketing/homepage-seo";

export const MARKETING_PAGE_FAQ: Record<string, HomeFaqItem[]> = {
  crm: [
    {
      question: "Co je CRM systém?",
      answer:
        "CRM je software pro evidenci zákazníků, obchodní komunikaci a navazující zakázky. V RAJMONDATA je CRM propojené s poptávkami, nabídkami, e-mailem a realizací — nejde o izolovaný seznam kontaktů.",
    },
    {
      question: "Pro koho je CRM vhodné?",
      answer:
        "Pro obchodníky a vedení firem, které vedou zakázky na míru — montáže, stavby, výroba na zakázku nebo servis. Hodí se i menším týmům, které chtějí online CRM bez synchronizace několika aplikací.",
    },
    {
      question: "Lze CRM používat online?",
      answer:
        "Ano. RAJMONDATA je webový CRM software — funguje v prohlížeči na počítači, tabletu i mobilu bez instalace na každé stanici.",
    },
    {
      question: "Umí RAJMONDATA CRM propojit se zakázkami?",
      answer:
        "Ano. Poptávka nebo nabídka se převede na zakázku se stejným zákazníkem, dokumenty a rozpočtem. Realizace, docházka a fakturace navazují na stejný záznam.",
    },
    {
      question: "Jak AI pomáhá v CRM?",
      answer:
        "AI navrhne odpovědi na e-maily, připraví návrh cenové nabídky z poptávky a ceníků a pomůže s dokumenty u obchodního případu. Finální text a ceny vždy schvaluje uživatel.",
    },
  ],
  "erp-system": [
    {
      question: "Co je ERP systém?",
      answer:
        "ERP (Enterprise Resource Planning) je firemní informační systém pro řízení procesů — zakázky, zdroje, sklad, výrobu a finance v provozu. RAJMONDATA pokrývá tyto oblasti v jednom portálu spolu s CRM.",
    },
    {
      question: "Jaký je rozdíl mezi CRM a ERP v RAJMONDATA?",
      answer:
        "CRM se zaměřuje na zákazníka a obchod od poptávky po zakázku. ERP vrstva zahrnuje realizaci, zaměstnance, docházku, výrobu, sklad a fakturaci. Data jsou ve stejném systému.",
    },
    {
      question: "Nahrazuje RAJMONDATA účetnictví?",
      answer:
        "Ne. Slouží k fakturaci a dokladům v návaznosti na zakázku; kompletní účetní agendu řeší váš účetní software nebo účetní.",
    },
    {
      question: "Je ERP vhodné pro malou firmu?",
      answer:
        "Ano, pokud potřebujete řídit zakázky, lidi a materiál na jednom místě. Moduly se aktivují podle licence — nemusíte hned používat všechny oblasti.",
    },
  ],
  "crm-zdarma": [
    {
      question: "Je RAJMONDATA CRM zdarma navždy?",
      answer:
        "Ne. Jde o placenou platformu s registrací firmy. Může být k dispozici zkušební období podle aktuálních podmínek — délku a rozsah určuje provozovatel po schválení registrace.",
    },
    {
      question: "Co znamená vyzkoušet zdarma?",
      answer:
        "Registrace umožní ověřit portál včetně CRM a zakázek v rámci trialu nebo schválené licence. Podmínky a ceník najdete na stránce funkcí; nejde o neomezený free tarif bez licencování.",
    },
  ],
  "rizeni-zakazek": [
    {
      question: "Co lze u zakázky evidovat?",
      answer:
        "Zákazníka, termíny, úkoly, pracovníky, zaměření, fotografie, rozpočet, vícepráce, smlouvy, faktury, výrobu, materiál a komunikaci — vše v jednom záznamu zakázky.",
    },
    {
      question: "Lze přidávat vícepráce?",
      answer:
        "Ano. Vícepráce se evidují v rozpočtu zakázky a navazují na fakturaci a schválení u zákazníka.",
    },
    {
      question: "Vidí zákazník průběh zakázky?",
      answer:
        "Ano, pokud máte zapnutý zákaznický portál. Zákazník vidí vybrané informace, fotografie a dokumenty podle nastavení firmy.",
    },
  ],
  "poptavky-a-nabidky": [
    {
      question: "Jak se dostane poptávka z webu do portálu?",
      answer:
        "Formulář na vašem webu může odesílat data do RAJMONDATA. Poptávka se zobrazí v portálu se stavem, kontaktem a historií.",
    },
    {
      question: "Umí systém AI nabídky?",
      answer:
        "Ano. AI připraví návrh nabídky z poptávky a ceníků. Text a ceny vždy kontrolujete před odesláním zákazníkovi.",
    },
  ],
  "email-pro-firmy": [
    {
      question: "Kolik firemních schránek lze připojit?",
      answer:
        "Podle nastavení organizace a modulu e-mail — typicky více IMAP/SMTP účtů s oprávněními pro jednotlivé uživatele.",
    },
    {
      question: "Lze e-mail přiřadit ke zakázce?",
      answer:
        "Ano. Zprávu i přílohy lze navázat na konkrétní zakázku, aby tým viděl historii u obchodního případu.",
    },
  ],
  "fakturace-a-doklady": [
    {
      question: "Nahrazuje RAJMONDATA účetní program?",
      answer:
        "Ne. Slouží k fakturaci a dokladům v návaznosti na zakázku; export a účetní agendu řeší váš účetní software.",
    },
  ],
  "firemni-portal": [
    {
      question: "Je RAJMONDATA jen webová aplikace?",
      answer:
        "Ano. Portál běží v prohlížeči na PC, tabletu i mobilu — není nutná instalace na každé stanici.",
    },
  ],
  "ai-pro-firmy": [
    {
      question: "Nahrazuje AI právníka nebo účetního?",
      answer:
        "Ne. AI připravuje návrhy textů a odpovědí. Finální rozhodnutí a kontrolu má vždy uživatel vaší firmy.",
    },
    {
      question: "K čemu slouží firemní znalostní báze?",
      answer:
        "Nahrané manuály a dokumenty lze prohledávat v portálu — asistent odpovídá podle firemních podkladů, pokud je modul aktivní.",
    },
  ],
  "dochazka-zamestnancu": [
    {
      question: "Jak funguje docházka na tabletu?",
      answer:
        "Externí tablet slouží jako terminál. Zaměstnanec zadá PIN, zaznamená příchod, odchod nebo přestávku. Data se ukládají do portálu.",
    },
    {
      question: "Lze opravit zapomenutý odchod?",
      answer:
        "Ano. Vedení může provést ruční korekci pro výplatu — surové záznamy z terminálu zůstávají pro audit.",
    },
    {
      question: "Může zaměstnanec vidět jen vlastní data?",
      answer:
        "Ano. Role a oprávnění určují, zda uživatel vidí jen svou docházku, nebo přehled celé firmy.",
    },
  ],
  fakturace: [
    {
      question: "Lze vystavit zálohovou i konečnou fakturu?",
      answer:
        "Ano. Faktury navazují na zakázku a rozpočet. Uživatel kontroluje částky a DPH před odesláním.",
    },
    {
      question: "Propojí se faktura s vícepracemi?",
      answer:
        "Ano. Položkový rozpočet a vícepráce jsou součástí zakázky a promítají se do fakturačních podkladů.",
    },
  ],
  "komunikace-se-zakazniky": [
    {
      question: "Co zákazník vidí v portálu?",
      answer:
        "Průběh zakázky, vybrané fotografie, dokumenty a chat s firmou — podle toho, co povolíte.",
    },
  ],
  "sklad-a-vyroba": [
    {
      question: "Je sklad vázaný na zakázku?",
      answer:
        "Ano. Výdej materiálu a spotřeba se evidují v kontextu konkrétní zakázky, pokud máte aktivní moduly výroby a skladu.",
    },
  ],
  "pro-remeslniky": [
    {
      question: "Je RAJMONDATA vhodné pro malé řemeslnické firmy?",
      answer:
        "Ano. Portál běží v prohlížeči na mobilu i tabletu — poptávky, zakázky v terénu a fakturace na jednom místě.",
    },
  ],
  "pro-montazni-firmy": [
    {
      question: "Jak pomáhá montážní firmě?",
      answer:
        "Spojí obchod, zaměření, montáže, výrobu, docházku montérů a fakturaci — bez roztříštěných tabulek a chatů.",
    },
  ],
};
