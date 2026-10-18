"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";

export default function RezervaceKonzultacePage() {
  const { toast } = useToast();
  const [organizationName, setOrganizationName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consultationType, setConsultationType] = useState<"phone" | "online">("phone");
  const [dateYmd, setDateYmd] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [note, setNote] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!dateYmd) return;
    void fetch(`/api/public/consultation/slots?date=${encodeURIComponent(dateYmd)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setSlots(d.slots ?? []);
      });
  }, [dateYmd]);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch("/api/public/consultation/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName,
          contactName,
          email,
          phone,
          consultationType,
          dateYmd,
          timeSlot,
          note,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setDone(true);
      toast({ title: "Rezervace potvrzena" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Rezervace",
        description: e instanceof Error ? e.message : "Chyba",
      });
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center space-y-4">
        <h1 className="text-2xl font-semibold text-orange-600">Děkujeme</h1>
        <p>Rezervace konzultace RAJMONDATA byla uložena. Potvrzení jsme odeslali na váš e-mail.</p>
        <Button asChild>
          <Link href="/portal/dashboard">Přejít do portálu</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Domluvit konzultaci RAJMONDATA</h1>
        <p className="text-sm text-slate-600 mt-1">Bezplatná telefonická nebo online konzultace.</p>
      </div>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label>Název organizace *</Label>
          <Input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Kontaktní osoba *</Label>
          <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>E-mail *</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Telefon</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Typ konzultace</Label>
          <select
            className="flex h-10 w-full rounded-md border px-3 text-sm"
            value={consultationType}
            onChange={(e) => setConsultationType(e.target.value as "phone" | "online")}
          >
            <option value="phone">Telefonická konzultace</option>
            <option value="online">Online schůzka</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label>Datum *</Label>
          <Input type="date" value={dateYmd} onChange={(e) => setDateYmd(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Čas *</Label>
          <select
            className="flex h-10 w-full rounded-md border px-3 text-sm"
            value={timeSlot}
            onChange={(e) => setTimeSlot(e.target.value)}
          >
            <option value="">— vyberte —</option>
            {slots.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Poznámka</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </div>
        <Button
          className="w-full bg-orange-500 hover:bg-orange-600 text-black"
          disabled={busy}
          onClick={() => void submit()}
        >
          Odeslat rezervaci
        </Button>
      </div>
    </div>
  );
}
