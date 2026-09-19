"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function FleetVehicleFormDialog({
  open,
  onOpenChange,
  companyId,
  getToken,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  getToken: () => Promise<string>;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    licensePlate: "",
    vin: "",
    make: "",
    model: "",
    year: "",
    currentDriverName: "",
    notes: "",
  });

  async function submit() {
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch("/api/company/fleet/vehicles", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, ...form, year: form.year ? Number(form.year) : null }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Uložení selhalo");
      onOpenChange(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Přidat vozidlo</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label>Název</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>SPZ</Label>
            <Input value={form.licensePlate} onChange={(e) => setForm({ ...form, licensePlate: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>VIN</Label>
            <Input value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Značka</Label>
            <Input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Model</Label>
            <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Rok</Label>
            <Input value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} inputMode="numeric" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Řidič (jméno / dočasně ručně)</Label>
            <Input
              value={form.currentDriverName}
              onChange={(e) => setForm({ ...form, currentDriverName: e.target.value })}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Poznámka</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            Uložit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
