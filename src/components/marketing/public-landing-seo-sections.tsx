import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HOME_FAQ } from "@/lib/marketing/homepage-seo";

function Section({
  id,
  title,
  children,
  altBg,
}: {
  id: string;
  title: string;
  children: ReactNode;
  altBg?: boolean;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-20 border-t border-white/10 py-10 sm:py-14 ${altBg ? "bg-slate-900/40" : ""}`}
    >
      <div className="mx-auto max-w-6xl px-3 sm:px-4 md:px-6">
        <h2 className="text-xl font-bold tracking-tight text-slate-50 sm:text-2xl md:text-3xl">{title}</h2>
        <div className="mt-4 max-w-3xl space-y-4 text-sm leading-relaxed text-slate-300 sm:text-base">
          {children}
        </div>
      </div>
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 text-slate-300">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

function WorkflowSteps() {
  const steps = [
    "Poptávka",
    "Nabídka",
    "Zákazník",
    "Zaměření",
    "Zakázka",
    "Úkoly",
    "Dokumentace",
    "Výroba / realizace",
    "Fakturace",
    "Předání",
  ];
  return (
    <ol className="flex flex-wrap gap-2 text-xs sm:text-sm">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 font-medium text-slate-100">
            {s}
          </span>
          {i < steps.length - 1 ? <span className="text-slate-500" aria-hidden="true">→</span> : null}
        </li>
      ))}
    </ol>
  );
}

function AudienceCards() {
  const items = [
    "Montážní firmy",
    "Stavební firmy",
    "Výrobní firmy",
    "Řemeslníci",
    "Firmy na pergoly a zimní zahrady",
    "Montované domy a zasklení",
    "Servisní firmy",
    "Firmy s vlastní výrobní dílnou",
    "Menší a střední firmy řídící zakázky",
  ];
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((label) => (
        <li
          key={label}
          className="rounded-xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-slate-200"
        >
          {label}
        </li>
      ))}
    </ul>
  );
}

function CtaBand() {
  return (
    <section className="border-t border-white/10 bg-gradient-to-r from-primary/20 via-slate-900 to-slate-950 py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-3 text-center sm:px-4 md:px-6">
        <h2 className="text-xl font-bold text-slate-50 sm:text-2xl">
          Chcete mít zakázky, zaměstnance, dokumenty a komunikaci v jednom systému?
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-300 sm:text-base">
          Registrace firmy probíhá online — moduly aktivuje provozovatel platformy po schválení.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" className="h-11 w-full sm:w-auto" asChild>
            <Link href="/register">Zjistit více — registrace firmy</Link>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-11 w-full border-white/20 bg-white/5 sm:w-auto"
            asChild
          >
            <Link href="/login">Přihlásit se</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

export function PublicLandingSeoSections() {
  return (
    <>
      <Section id="rizeni-zakazek" title="Řízení zakázek od první poptávky až po fakturu">
        <p>
          RAJMONDATA je systém pro řízení zakázek a firemní portál, který pokrývá celý workflow — od
          první poptávky po fakturaci. Evidence zakázek, zákazníků a dokumentů zůstává na jednom místě,
          bez přepisování mezi tabulkami a e-maily.
        </p>
        <WorkflowSteps />
        <p className="pt-2">V jedné zakázce máte mimo jiné:</p>
        <BulletList
          items={[
            "Zákazníka a adresu realizace",
            "Termíny a přiřazené pracovníky",
            "Úkoly a průběh realizace",
            "Fotodokumentaci a složky",
            "Smlouvy, dodatky a PDF",
            "Položkový rozpočet, vícepráce a zálohy",
            "Faktury a komunikaci",
            "Výrobní informace a materiál",
          ]}
        />
      </Section>

      <Section id="poptavky" title="Poptávky z webu přímo do firemního portálu" altBg>
        <p>
          Poptávka se nemusí přepisovat z e-mailu do několika systémů. Integrace poptávkových
          formulářů z vašeho webu doručí leady do RAJMONDATA — s přehledem nových poptávek, přiřazením
          obchodníkovi a odpovědí z portálu.
        </p>
        <p>
          Poptávku lze převést na nabídku a následně na zakázku. AI může pomoci připravit návrh
          nabídky podle firemních pravidel — výsledek vždy kontrolujete.
        </p>
      </Section>

      <Section id="ai-nabidky" title="AI nabídky připravené podle vašich pravidel">
        <p>
          Software pro montážní firmy a řemeslníky často ztrácí čas ručním psaním nabídek. AI v
          RAJMONDATA využije údaje z poptávky, rozměry, firemní ceníky, pravidla, příklady nabídek a
          nahranou dokumentaci z AI centra.
        </p>
        <p>
          Připraví profesionální návrh nabídky k vaší kontrole — rychlejší reakce zákazníkovi,
          jednotný styl a méně ručního přepisování. Automaticky správný výstup bez kontroly
          nečekejte.
        </p>
      </Section>

      <Section id="ai-smlouvy" title="AI pomoc se smlouvami a dodatky" altBg>
        <p>
          Na zakázce můžete zadat instrukci, například: „Prodloužit termín dokončení do 30. 9. a
          přidat vícepráce za 150 000 Kč.“ AI připraví návrh textu dodatku podle dat zakázky a
          smlouvy.
        </p>
        <p>
          Stejně lze pracovat s návrhy smluv — text je editovatelný, lze exportovat do PDF nebo tisku.
          AI připraví návrh, finální dokument vždy kontroluje uživatel.
        </p>
      </Section>

      <Section id="ai-asistent" title="AI asistent, který se orientuje v celém portálu">
        <p>Asistent odpovídá na otázky typu:</p>
        <BulletList
          items={[
            "Kde vytvořím zálohovou fakturu?",
            "Jak přidám vícepráci?",
            "Kde najdu dokument zákazníka?",
            "Jak vytvořím dodatek ke smlouvě?",
            "Kde změním oprávnění zaměstnance?",
            "Jak přegeneruji fakturu po změně rozpočtu?",
          ]}
        />
        <p>
          Využívá strukturu portálu, firemní návody, AI centrum a kontext aktuální stránky. Pomůže
          také hledat informace v nahraných manuálech a interní dokumentaci.
        </p>
      </Section>

      <Section id="vyhledavani" title="Najděte zákazníka, zakázku, fakturu nebo dokument během chvíle" altBg>
        <p>
          Globální vyhledávání v portálu pro zákazníky, zakázky, faktury, doklady, PDF a další firemní
          data. Zaměstnanec nemusí procházet jednotlivé moduly — CRM pro řemeslníky a montážní firmy
          v praxi znamená i rychlý přístup k informaci.
        </p>
      </Section>

      <Section id="dochazka" title="Docházka, práce a zaměstnanci na jednom místě">
        <p>
          Evidence zaměstnanců, rolí, docházky, práce a mezd, hodinových sazeb a výkazů v jednom
          podnikovém informačním systému.
        </p>
        <p className="font-medium text-slate-200">Docházkový terminál lze používat na externím tabletu.</p>
        <p>
          Tablet na dílně nebo provozovně, přihlášení PINem zaměstnance, příchod a odchod — data se
          propisují do portálu. Vhodné pro montážní firmy, řemeslníky, dílny i výrobní provozy.
        </p>
      </Section>

      <Section id="zamereni" title="Zaměření a realizace v terénu" altBg>
        <p>
          Plánování zaměření se zákazníkem, adresou, termínem, telefonem, poznámkou a předběžnou
          cenou. Po zaměření snadný převod na zakázku, fotodokumentace a poznámky pro montážníky.
        </p>
        <p>
          Řízení montáží a zakázek v terénu — vhodné pro pergoly, zimní zahrady, montované domy,
          zasklení, stavební práce, servis i další řemeslné firmy.
        </p>
      </Section>

      <Section id="fotodokumentace" title="Fotodokumentace přímo u zakázky">
        <BulletList
          items={[
            "Nahrávání fotografií do složek u zakázky",
            "Foto zaměření a z realizace",
            "Fotografie pro zákaznický portál",
            "Dokumentace práce s přístupem montážníků",
          ]}
        />
      </Section>

      <Section id="zakaznicky-portal" title="Zákazník vidí průběh své zakázky" altBg>
        <p>
          Zákaznický portál ukazuje průběh zakázky, procento dokončení, vybrané fotografie, dokumenty
          a komunikaci. Firma nemusí každému zákazníkovi opakovaně posílat stejné informace ručně.
        </p>
      </Section>

      <Section id="komunikace" title="Komunikace se zákazníky i zaměstnanci">
        <p>
          Zákaznický chat, interní chat k zakázce, zprávy zaměstnanců a historie u zakázky. Informace
          nezůstávají jen v osobních WhatsApp zprávách, SMS nebo roztříštěných e-mailech.
        </p>
      </Section>

      <Section id="email" title="Nabídky, dokumenty a e-maily přímo z portálu" altBg>
        <p>
          Odesílání nabídek e-mailem s přílohami a PDF, návaznost na zákazníka nebo poptávku a historie
          odeslání. Uživatel nemusí přepínat mezi několika aplikacemi.
        </p>
      </Section>

      <Section id="fakturace" title="Rozpočty, vícepráce, zálohy a fakturace">
        <BulletList
          items={[
            "Položkový a základní rozpočet zakázky",
            "Vícepráce a provedené položky",
            "Zálohy a zálohové faktury",
            "Konečná faktura a přegenerování po změně rozpočtu",
            "Přehled zbývající částky a DPH",
          ]}
        />
      </Section>

      <Section id="doklady" title="Doklady a PDF na jednom místě" altBg>
        <p>
          Přijaté a vydané doklady, faktury, PDF, fotografie dokladů, kategorie, přiřazení k zakázce,
          filtrování a hledání — dokumenty a fakturace v jednom firemním portálu.
        </p>
      </Section>

      <Section id="vyroba" title="Výroba a materiál propojené se zakázkou">
        <p>
          Stav výroby, výrobní dílna, materiál, objednávky, sklad, spotřeba a dokumentace navázané na
          konkrétní zakázku — výroba a sklad jako součást řízení zakázek.
        </p>
      </Section>

      <Section id="opravneni" title="Každý zaměstnanec vidí jen to, co potřebuje">
        <p>Oprávnění k modulům portálu: bez přístupu, náhled (READ) nebo zápis (WRITE).</p>
        <BulletList
          items={[
            "Účetní může mít pouze náhled dokladů",
            "Obchodník zápis do poptávek a nabídek",
            "Montážník přístup ke svým zakázkám",
            "Skladník ke skladu a výrobě",
          ]}
        />
        <p>Data jednotlivých organizací jsou v systému oddělená — každá firma pracuje ve svém tenantu.</p>
      </Section>

      <Section id="pro-koho" title="Pro koho je RAJMONDATA" altBg>
        <p>
          Firemní software a podnikový portál pro firmy, které potřebují přehled nad zakázkami od
          první poptávky po fakturu.
        </p>
        <AudienceCards />
      </Section>

      <Section id="benefity" title="Méně přepisování. Více přehledu.">
        <BulletList
          items={[
            "Všechna data na jednom místě",
            "Rychlejší reakce na poptávky",
            "Méně ruční administrativy",
            "Lepší kontrola zakázek",
            "AI pomoc s dokumenty a nabídkami",
            "Jednodušší práce zaměstnanců",
            "Přehled financí a historie komunikace",
            "Přístup z počítače, tabletu a telefonu",
          ]}
        />
      </Section>

      <Section id="integrace" title="RAJMONDATA se přizpůsobí vašemu workflow" altBg>
        <p>
          Napojení poptávkových formulářů z webu, firemní e-mailové workflow, externí weby, AI služby a
          dokumenty. Systém lze dále napojovat na firemní procesy a externí služby podle konkrétní
          implementace — včetně API tam, kde je k dispozici.
        </p>
      </Section>

      <section id="faq" className="scroll-mt-20 border-t border-white/10 py-10 sm:py-14">
        <div className="mx-auto max-w-6xl px-3 sm:px-4 md:px-6">
          <h2 className="text-xl font-bold text-slate-50 sm:text-2xl md:text-3xl">Časté otázky</h2>
          <dl className="mt-6 space-y-6">
            {HOME_FAQ.map((item) => (
              <div key={item.question} className="rounded-xl border border-white/10 bg-slate-950/40 p-4 sm:p-5">
                <dt className="text-base font-semibold text-slate-100">{item.question}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-slate-300 sm:text-base">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
