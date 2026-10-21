"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PublicMarketingHeader } from "@/components/marketing/public-marketing-header";
import {
  orderDemoStepsForInterest,
  type ProductDemoInterest,
  type ProductDemoStep,
} from "@/lib/ai-tutor/product-demo-script";
import { Pause, Play, SkipForward, Volume2, VolumeX } from "lucide-react";

const VISITOR_KEY = "rajmondata_vid_v1";
const INTEREST_KEY = "rajmondata_demo_interest";

function visitorId(): string {
  try {
    let id = sessionStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

function trackDemo(event: string, extra?: Record<string, string>) {
  const vid = visitorId();
  if (vid === "anonymous") return;
  void fetch("/api/public/product-tour/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, visitorId: vid, path: "/prohlidka", ...extra }),
    keepalive: true,
  }).catch(() => {});
}

const DEMO_DATA = {
  company: "Ukázková firma s.r.o.",
  job: "Rekonstrukce RD — Brno",
  customer: "Novák Jan",
  vehicle: "kovokan s.r.o. (V6031)",
};

export function ProductDemoPage() {
  const [interest, setInterest] = useState<ProductDemoInterest | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [started, setStarted] = useState(false);
  const [ask, setAsk] = useState("");
  const [askReply, setAskReply] = useState<string | null>(null);

  const steps = useMemo(
    () => (interest ? orderDemoStepsForInterest(interest) : []),
    [interest]
  );
  const step: ProductDemoStep | undefined = steps[stepIndex];

  useEffect(() => {
    trackDemo("demo_opened");
    try {
      const saved = sessionStorage.getItem(INTEREST_KEY) as ProductDemoInterest | null;
      if (saved) setInterest(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!started || paused || !step) return;
    const t = window.setTimeout(() => {
      if (stepIndex >= steps.length - 1) {
        trackDemo("demo_completed");
        return;
      }
      setStepIndex((i) => i + 1);
      trackDemo("demo_step_viewed", { stepId: steps[stepIndex + 1]?.id ?? "" });
    }, step.durationSec * 1000);
    return () => window.clearTimeout(t);
  }, [started, paused, step, stepIndex, steps]);

  const pickInterest = (i: ProductDemoInterest) => {
    setInterest(i);
    try {
      sessionStorage.setItem(INTEREST_KEY, i);
    } catch {
      /* ignore */
    }
    trackDemo("demo_interest_selected", { interest: i });
  };

  const begin = () => {
    setStarted(true);
    setStepIndex(0);
    trackDemo("demo_started");
    trackDemo("demo_step_viewed", { stepId: steps[0]?.id ?? "intro" });
  };

  const registerHref = useMemo(() => {
    const q = interest ? `?demoInterest=${encodeURIComponent(interest)}` : "";
    return `/register${q}`;
  }, [interest]);

  const submitAsk = useCallback(async () => {
    if (!ask.trim()) return;
    const res = await fetch("/api/public/product-tour/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: ask.trim() }),
    });
    const json = await res.json();
    if (json.ok) setAskReply(json.answer);
    trackDemo("demo_ask");
  }, [ask]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <PublicMarketingHeader />
      <div className="mx-auto max-w-6xl px-4 py-8 grid lg:grid-cols-2 gap-8">
        <div className="space-y-4">
          {!interest ? (
            <Card className="bg-slate-900/80 border-slate-700 text-slate-100">
              <CardContent className="pt-6 space-y-4">
                <h1 className="text-2xl font-bold">AI prohlídka — 2 minuty</h1>
                <p className="text-slate-300">Co vás nejvíce zajímá?</p>
                <div className="flex flex-col gap-2">
                  {(
                    [
                      ["jobs", "Řízení zakázek"],
                      ["team", "Zaměstnanci a docházka"],
                      ["finance", "Fakturace a finance"],
                      ["production", "Výroba a sklad"],
                      ["full", "Kompletní řízení firmy"],
                    ] as const
                  ).map(([id, label]) => (
                    <Button key={id} variant="outline" className="justify-start border-slate-600" onClick={() => pickInterest(id)}>
                      {label}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {!started ? (
                  <Button className="bg-orange-500 hover:bg-orange-600" onClick={begin}>
                    <Play className="mr-2 h-4 w-4" /> Spustit prohlídku
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setPaused((p) => !p)}>
                    {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setMuted((m) => !m)} aria-label="Zvuk">
                  {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    trackDemo("demo_skipped");
                    setStepIndex((i) => Math.min(steps.length - 1, i + 1));
                  }}
                >
                  <SkipForward className="h-4 w-4" /> Přeskočit krok
                </Button>
              </div>
              {step ? (
                <Card className="bg-slate-900/80 border-primary/30">
                  <CardContent className="pt-6">
                    <p className="text-xs text-primary">{step.segment}</p>
                    <h2 className="text-xl font-semibold mt-1">{step.title}</h2>
                    <p className="mt-3 text-slate-300 leading-relaxed">{step.narration}</p>
                    {!muted ? (
                      <p className="mt-2 text-xs text-slate-500">Hlasový výklad — připravujeme (text je vždy k dispozici).</p>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button asChild onClick={() => trackDemo("demo_cta_clicked")}>
                  <Link href={registerHref}>Vyzkoušet 30 dní zdarma</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/#pricing">Zobrazit ceník</Link>
                </Button>
              </div>
              <div className="border border-slate-700 rounded-lg p-3 space-y-2">
                <input
                  className="w-full rounded bg-slate-950 border border-slate-600 px-3 py-2 text-sm"
                  placeholder="Zeptat se AI…"
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                />
                <Button size="sm" variant="secondary" onClick={() => void submitAsk()}>
                  Odeslat dotaz
                </Button>
                {askReply ? <p className="text-sm text-slate-300">{askReply}</p> : null}
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900/50 overflow-hidden min-h-[420px]">
          <div className="bg-slate-800 px-4 py-2 text-xs text-slate-400">DEMO režim — ukázková data</div>
          <div className="p-4 grid grid-cols-3 gap-2 text-xs">
            {["Přehled", "Zakázky", "Zákazníci", "Tým", "E-mail", "Fakturace", "Sklad", "GPS"].map((m) => (
              <div
                key={m}
                className={`rounded px-2 py-2 border ${
                  step?.demoPanel === "jobs" && m === "Zakázky"
                    ? "border-orange-500 bg-orange-500/10"
                    : "border-slate-600"
                }`}
              >
                {m}
              </div>
            ))}
          </div>
          <div className="p-4 space-y-2 text-sm" data-tour-id="demo-jobs-list">
            <p className="font-medium">{DEMO_DATA.company}</p>
            <p>Zakázka: {DEMO_DATA.job}</p>
            <p>Zákazník: {DEMO_DATA.customer}</p>
            <p>GPS: {DEMO_DATA.vehicle}</p>
            <p className="text-xs text-slate-500 pt-4">
              Demonstrační prostředí — žádná produkční data, žádný zápis do databáze.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
