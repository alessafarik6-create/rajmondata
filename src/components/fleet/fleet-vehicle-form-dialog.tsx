"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const EMPTY = {
  name: "",
  licensePlate: "",
  vin: "",
  make: "",
  model: "",
  year: "",
  vehicleType: "",
  fuelType: "",
  avgConsumptionL100: "",
  odometerKm: "",
  gpsDevicePhone: "",
  externalVehicleId: "",
  externalDeviceId: "",
  currentDriverName: "",
  stkExpiresAt: "",
  insuranceExpiresAt: "",
  serviceDueAt: "",
  oilChangeDueAt: "",
  tiresChangeDueAt: "",
  notes: "",
};

export function FleetVehicleFormDialog({
  open,
  onOpenChange,
  companyId,
  vehicleId,
  getToken,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  vehicleId?: string | null;
  getToken: () => Promise<string>;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  useEffect(() => {
    if (!open) return;
    if (!vehicleId) {
      setForm({ ...EMPTY });
      return;
    }
    void (async () => {
      const token = await getToken();
      const res = await fetch(
        `/api/company/fleet/vehicles/${encodeURIComponent(vehicleId)}?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!data.ok || !data.vehicle) return;
      const v = data.vehicle as Record<string, unknown>;
      setForm({
        name: String(v.name ?? ""),
        licensePlate: String(v.licensePlate ?? ""),
        vin: String(v.vin ?? ""),
        make: String(v.make ?? ""),
        model: String(v.model ?? ""),
        year: v.year != null ? String(v.year) : "",
        vehicleType: String(v.vehicleType ?? ""),
        fuelType: String(v.fuelType ?? ""),
        avgConsumptionL100: v.avgConsumptionL100 != null ? String(v.avgConsumptionL100) : "",
        odometerKm: v.odometerKm != null ? String(v.odometerKm) : "",
        gpsDevicePhone: String(v.gpsDevicePhone ?? ""),
        externalVehicleId: String(v.externalVehicleId ?? ""),
        externalDeviceId: String(v.externalDeviceId ?? ""),
        currentDriverName: String(v.currentDriverName ?? ""),
        stkExpiresAt: String(v.stkExpiresAt ?? "").slice(0, 10),
        insuranceExpiresAt: String(v.insuranceExpiresAt ?? "").slice(0, 10),
        serviceDueAt: String(v.serviceDueAt ?? "").slice(0, 10),
        oilChangeDueAt: String(v.oilChangeDueAt ?? "").slice(0, 10),
        tiresChangeDueAt: String(v.tiresChangeDueAt ?? "").slice(0, 10),
        notes: String(v.notes ?? ""),
      });
    })();
  }, [open, vehicleId, companyId, getToken]);

  async function submit() {
    setBusy(true);
    try {
      const token = await getToken();
      const payload = {
        companyId,
        ...form,
        year: form.year ? Number(form.year) : null,
        avgConsumptionL100: form.avgConsumptionL100 ? Number(form.avgConsumptionL100) : null,
        odometerKm: form.odometerKm ? Number(form.odometerKm) : null,
        externalProvider: form.externalVehicleId ? "SATELITNI_SLEDOVANI" : null,
      };
      const res = await fetch(
        vehicleId
          ? `/api/company/fleet/vehicles/${encodeURIComponent(vehicleId)}`
          : "/api/company/fleet/vehicles",
        {
          method: vehicleId ? "PATCH" : "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{vehicleId ? "Upravit vozidlo" : "Přidat vozidlo"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label>Název vozidla</Label>
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
            <Label>Rok výroby</Label>
            <Input value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} inputMode="numeric" />
          </div>
          <div className="space-y-1">
            <Label>Typ vozidla</Label>
            <Input value={form.vehicleType} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })} placeholder="Dodávka, osobní…" />
          </div>
          <div className="space-y-1">
            <Label>Typ paliva</Label>
            <Input value={form.fuelType} onChange={(e) => setForm({ ...form, fuelType: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Průměrná spotřeba (l/100 km)</Label>
            <Input value={form.avgConsumptionL100} onChange={(e) => setForm({ ...form, avgConsumptionL100: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Stav tachometru (km)</Label>
            <Input value={form.odometerKm} onChange={(e) => setForm({ ...form, odometerKm: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>GPS ID (externí vozidlo)</Label>
            <Input value={form.externalVehicleId} onChange={(e) => setForm({ ...form, externalVehicleId: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>GPS zařízení / jednotka ID</Label>
            <Input value={form.externalDeviceId} onChange={(e) => setForm({ ...form, externalDeviceId: e.target.value })} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Telefon GPS jednotky</Label>
            <Input value={form.gpsDevicePhone} onChange={(e) => setForm({ ...form, gpsDevicePhone: e.target.value })} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Aktuální řidič (návrh — potvrďte u jízdy, pokud GPS neidentifikuje řidiče)</Label>
            <Input value={form.currentDriverName} onChange={(e) => setForm({ ...form, currentDriverName: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Platnost STK</Label>
            <Input type="date" value={form.stkExpiresAt} onChange={(e) => setForm({ ...form, stkExpiresAt: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Platnost pojištění</Label>
            <Input type="date" value={form.insuranceExpiresAt} onChange={(e) => setForm({ ...form, insuranceExpiresAt: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Servisní prohlídka</Label>
            <Input type="date" value={form.serviceDueAt} onChange={(e) => setForm({ ...form, serviceDueAt: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Výměna oleje</Label>
            <Input type="date" value={form.oilChangeDueAt} onChange={(e) => setForm({ ...form, oilChangeDueAt: e.target.value })} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Přezutí pneumatik</Label>
            <Input type="date" value={form.tiresChangeDueAt} onChange={(e) => setForm({ ...form, tiresChangeDueAt: e.target.value })} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Poznámky</Label>
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
