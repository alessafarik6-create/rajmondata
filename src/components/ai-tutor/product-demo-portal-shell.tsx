"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Bell, Sparkles } from "lucide-react";
import type { DemoHighlight, DemoView, ProductDemoStep } from "@/lib/ai-tutor/product-demo-script";
import { cn } from "@/lib/utils";

const DEMO = {
  company: "Ukázková firma s.r.o.",
  jobTitle: "Rekonstrukce RD — Brno",
  customer: "Novák Jan",
  employee: "Dvořák Petr",
  invoice: "FV2026/0042",
  vehicle: "Škoda Transit (demo)",
  gps: "Brno — střed",
};

const NAV_ITEMS = [
  "Přehled",
  "Zaměstnanci",
  "Zákazníci",
  "Zakázky",
  "Kalendář",
  "E-mail",
  "Faktury",
  "Finance",
  "Sklad",
  "Výroba",
  "Vozový park",
  "AI centrum",
] as const;

function highlightNav(label: string, highlight?: DemoHighlight): boolean {
  if (!highlight) return false;
  if (highlight === "nav-jobs") return label === "Zakázky";
  if (highlight === "nav-team") return label === "Zaměstnanci";
  if (highlight === "nav-email") return label === "E-mail";
  if (highlight === "nav-invoices") return label === "Faktury";
  if (highlight === "nav-warehouse") return label === "Sklad";
  if (highlight === "nav-fleet") return label === "Vozový park";
  return false;
}

type Props = {
  step?: ProductDemoStep;
};

export function ProductDemoPortalShell({ step }: Props) {
  const view: DemoView = step?.demoView ?? "dashboard";
  const highlight = step?.highlight;
  const [typedTitle, setTypedTitle] = useState("");

  useEffect(() => {
    if (view !== "jobs-form") {
      setTypedTitle("");
      return;
    }
    const full = DEMO.jobTitle;
    let i = 0;
    const t = window.setInterval(() => {
      i += 1;
      setTypedTitle(full.slice(0, i));
      if (i >= full.length) window.clearInterval(t);
    }, 80);
    return () => window.clearInterval(t);
  }, [view]);

  const cursor = useMemo(() => {
    if (highlight === "nav-jobs") return { left: "18%", top: "32%" };
    if (highlight === "btn-new-job") return { left: "72%", top: "22%" };
    if (highlight === "btn-contract") return { left: "68%", top: "48%" };
    if (highlight === "btn-send-email") return { left: "55%", top: "62%" };
    if (highlight === "nav-team") return { left: "18%", top: "24%" };
    if (highlight === "nav-email") return { left: "18%", top: "44%" };
    if (highlight === "nav-fleet") return { left: "18%", top: "78%" };
    if (highlight === "ai-widget") return { left: "88%", top: "75%" };
    return null;
  }, [highlight]);

  return (
    <div className="relative flex h-full min-h-[480px] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950 text-slate-100 text-sm">
      <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div className="font-bold text-orange-500 tracking-tight">RAJMONDATA</div>
        <div className="ml-auto flex items-center gap-2 text-slate-400">
          <Search className="h-4 w-4" />
          <Bell className="h-4 w-4" />
          <span className="hidden sm:inline text-xs">{DEMO.company}</span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[140px] shrink-0 border-r border-slate-800 bg-slate-900/80 p-2 md:block">
          <ul className="space-y-0.5 text-[11px]">
            {NAV_ITEMS.map((label) => {
              const active =
                (view === "dashboard" && label === "Přehled") ||
                (view.startsWith("jobs") && label === "Zakázky") ||
                (view === "team" && label === "Zaměstnanci") ||
                (view === "email-ai" && label === "E-mail") ||
                (view === "invoices" && label === "Faktury") ||
                (view === "warehouse" && label === "Sklad") ||
                (view === "production" && label === "Výroba") ||
                (view === "gps" && label === "Vozový park") ||
                (view === "customers" && label === "Zákazníci");
              const ring = highlightNav(label, highlight);
              return (
                <li
                  key={label}
                  className={cn(
                    "rounded px-2 py-1.5 transition-colors",
                    active && "bg-orange-500/15 text-orange-200",
                    ring && "ring-2 ring-orange-500 ring-offset-1 ring-offset-slate-900 animate-pulse"
                  )}
                >
                  {label}
                </li>
              );
            })}
          </ul>
        </aside>
        <main className="relative min-w-0 flex-1 overflow-auto p-3 md:p-4">
          {view === "dashboard" && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold">Přehled firmy</h2>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {[
                  ["Aktivní zakázky", "12"],
                  ["Faktury k úhradě", "3"],
                  ["Ve výrobě", "2"],
                  ["Vozidla online", "4"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-slate-700 bg-slate-900/60 p-2">
                    <p className="text-[10px] text-slate-400">{k}</p>
                    <p className="text-lg font-bold text-orange-400">{v}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-slate-700 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-800 text-slate-400">
                    <tr>
                      <th className="p-2">Zakázka</th>
                      <th className="p-2">Stav</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-slate-800">
                      <td className="p-2">{DEMO.jobTitle}</td>
                      <td className="p-2 text-emerald-400">Probíhá</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(view === "jobs-list" || view === "jobs-form" || view === "job-detail" || view === "contract" || view === "email-compose") && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">Zakázky</h2>
                <button
                  type="button"
                  className={cn(
                    "rounded-md bg-orange-500 px-3 py-1.5 text-xs font-medium text-white",
                    highlight === "btn-new-job" && "ring-2 ring-white animate-pulse"
                  )}
                >
                  Nová zakázka
                </button>
              </div>
              {view === "jobs-form" && (
                <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 space-y-2 max-w-md">
                  <label className="block text-[10px] text-slate-400">Zákazník</label>
                  <div
                    className={cn(
                      "rounded border border-slate-600 bg-slate-950 px-2 py-1.5",
                      highlight === "field-customer" && "ring-2 ring-orange-500"
                    )}
                  >
                    {DEMO.customer}
                  </div>
                  <label className="block text-[10px] text-slate-400">Název zakázky</label>
                  <div className="rounded border border-slate-600 bg-slate-950 px-2 py-1.5 min-h-[2rem]">
                    {typedTitle}
                    <span className="animate-pulse">|</span>
                  </div>
                  <button
                    type="button"
                    className={cn(
                      "mt-2 w-full rounded bg-primary py-2 text-xs font-medium",
                      highlight === "btn-save-job" && "ring-2 ring-orange-400"
                    )}
                  >
                    Uložit zakázku
                  </button>
                </div>
              )}
              {(view === "job-detail" || view === "contract" || view === "email-compose") && (
                <div className="rounded-lg border border-slate-700 p-3 space-y-2">
                  <p className="font-medium">{DEMO.jobTitle}</p>
                  <p className="text-xs text-slate-400">Zákazník: {DEMO.customer}</p>
                  {view === "contract" && (
                    <button
                      type="button"
                      className={cn(
                        "rounded border border-orange-500/50 bg-orange-500/10 px-3 py-2 text-xs",
                        highlight === "btn-contract" && "ring-2 ring-orange-500 animate-pulse"
                      )}
                    >
                      Vytvořit smlouvu o dílo (PDF)
                    </button>
                  )}
                  {view === "email-compose" && (
                    <div className="space-y-2 text-xs">
                      <p>Komu: {DEMO.customer} &lt;demo@example.cz&gt;</p>
                      <p>Předmět: Smlouva o dílo — {DEMO.jobTitle}</p>
                      <p className="text-slate-400">Příloha: smlouva-o-dilo-demo.pdf</p>
                      <button
                        type="button"
                        className={cn(
                          "rounded bg-orange-500 px-4 py-2 font-medium",
                          highlight === "btn-send-email" && "ring-2 ring-white animate-pulse"
                        )}
                      >
                        Odeslat (demo)
                      </button>
                    </div>
                  )}
                </div>
              )}
              {view === "jobs-list" && (
                <div data-tour-id="demo-jobs-list" className="rounded border border-slate-700">
                  <div className="border-b border-slate-800 p-2 text-xs">{DEMO.jobTitle}</div>
                </div>
              )}
            </div>
          )}

          {view === "team" && (
            <div className="space-y-2" data-tour-id="demo-team">
              <h2 className="font-semibold">Zaměstnanci</h2>
              <table className="w-full text-xs border border-slate-700 rounded overflow-hidden">
                <thead className="bg-slate-800">
                  <tr>
                    <th className="p-2 text-left">Jméno</th>
                    <th className="p-2 text-left">Role</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-800">
                    <td className="p-2">{DEMO.employee}</td>
                    <td className="p-2">Montážník</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {view === "email-ai" && (
            <div className="grid gap-3 lg:grid-cols-2" data-tour-id="demo-ai">
              <div className="rounded-lg border border-slate-700 p-3">
                <h2 className="font-semibold mb-2">E-mail</h2>
                <p className="text-xs text-slate-400">Doručená pošta (demo)</p>
                <p className="mt-2 text-xs">Poptávka: oprava střechy</p>
              </div>
              <div
                className={cn(
                  "rounded-lg border border-orange-500/40 bg-orange-500/5 p-3",
                  highlight === "ai-widget" && "ring-2 ring-orange-500"
                )}
              >
                <h2 className="font-semibold flex items-center gap-1">
                  <Sparkles className="h-4 w-4 text-orange-400" /> AI sekretářka
                </h2>
                <p className="mt-2 text-xs text-slate-300">
                  „Navrhnu odpověď zákazníkovi a připravím nabídku ze šablony.“
                </p>
              </div>
            </div>
          )}

          {(view === "finance" || view === "invoices") && (
            <div data-tour-id="demo-ops">
              <h2 className="font-semibold">Faktury</h2>
              <p className="text-xs mt-2">{DEMO.invoice} — {DEMO.customer} — 48 500 Kč</p>
            </div>
          )}

          {view === "warehouse" && (
            <div>
              <h2 className="font-semibold">Sklad</h2>
              <p className="text-xs mt-2">Položka: Profil ALU — 240 ks (demo)</p>
            </div>
          )}

          {view === "production" && (
            <div>
              <h2 className="font-semibold">Výroba</h2>
              <p className="text-xs mt-2">Zakázka ve výrobě: {DEMO.jobTitle}</p>
            </div>
          )}

          {view === "gps" && (
            <div className="space-y-2">
              <h2 className="font-semibold">GPS mapa vozidel</h2>
              <div className="h-40 rounded-lg border border-slate-700 bg-slate-800/80 flex items-center justify-center text-xs text-slate-400">
                Mapa (demo) — {DEMO.vehicle} · {DEMO.gps}
              </div>
            </div>
          )}

          {view === "customers" && (
            <div>
              <h2 className="font-semibold">Zákazníci</h2>
              <p className="text-xs mt-2">{DEMO.customer}</p>
            </div>
          )}

          <p className="mt-4 text-[10px] text-slate-500">
            Demonstrační prostředí — fiktivní data, bez zápisu do databáze.
          </p>
        </main>
      </div>

      {cursor && highlight ? (
        <div
          className="pointer-events-none absolute z-20 h-5 w-5 -translate-x-1/2 -translate-y-1/2 transition-all duration-700 ease-out"
          style={{ left: cursor.left, top: cursor.top }}
          aria-hidden
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 drop-shadow-lg fill-white stroke-slate-900 stroke-[1.5]">
            <path d="M5 3l14 9-6.5 1.5L10 21 5 3z" />
          </svg>
        </div>
      ) : null}
    </div>
  );
}
