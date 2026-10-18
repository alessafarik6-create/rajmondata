"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type ModuleRow = {
  code: string;
  name: string;
  moduleKind?: string;
  active: boolean;
  priceMonthlyCzk: number;
  assignedUsers: number;
  seatCount: number;
  entitlement: Record<string, unknown>;
};

export function OrganizationModulesLicensesPanel(props: { organizationId: string; organizationName: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ModuleRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [assignUserId, setAssignUserId] = useState("");
  const [selectedCode, setSelectedCode] = useState("rajmondata_editor");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/superadmin/companies/${props.organizationId}/module-licenses`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json();
      if (data.ok) setRows(data.modules ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [props.organizationId]);

  async function patch(action: string, extra?: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/superadmin/companies/${props.organizationId}/module-licenses`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleCode: selectedCode, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast({ title: "Licence aktualizována" });
      await load();
    } catch (e) {
      toast({ variant: "destructive", title: "Chyba", description: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  }

  async function assignUser(active: boolean) {
    if (!assignUserId.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/superadmin/companies/${props.organizationId}/module-user-assignments`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ moduleCode: selectedCode, userId: assignUserId.trim(), active }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast({ title: active ? "Uživatel přiřazen" : "Přiřazení odebráno" });
      setAssignUserId("");
      await load();
    } catch (e) {
      toast({ variant: "destructive", title: "Chyba", description: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  }

  const selected = rows.find((r) => r.code === selectedCode) ?? rows[0];

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Organizace: <strong>{props.organizationName}</strong> — moduly, licence a přidělení uživatelů.
      </p>
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin" />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {rows.map((r) => (
              <Button
                key={r.code}
                type="button"
                size="sm"
                variant={selectedCode === r.code ? "default" : "outline"}
                onClick={() => setSelectedCode(r.code)}
              >
                {r.name}
              </Button>
            ))}
          </div>
          {selected ? (
            <div className="rounded-md border p-4 space-y-3 text-sm">
              <div className="grid sm:grid-cols-2 gap-2">
                <div>Stav: {selected.active ? "aktivní" : "neaktivní"}</div>
                <div>Cena: {selected.priceMonthlyCzk} Kč / měs.</div>
                <div>Licence: {selected.assignedUsers} / {selected.seatCount} uživatelů</div>
                <div>Typ: {selected.moduleKind ?? "internal"}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => void patch("activate_free")}>
                  Aktivovat zdarma
                </Button>
                <Button size="sm" disabled={busy} onClick={() => void patch("activate_paid")}>
                  Placená licence
                </Button>
                <Button size="sm" disabled={busy} onClick={() => void patch("trial", { days: 14 })}>
                  Zkušební období
                </Button>
                <Button size="sm" disabled={busy} onClick={() => void patch("extend")}>
                  Prodloužit
                </Button>
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => void patch("suspend")}>
                  Pozastavit
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void patch("remove")}>
                  Odebrat přístup
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-2 pt-2 border-t">
                <div className="space-y-1">
                  <Label>Firebase UID uživatele</Label>
                  <Input value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)} className="w-72" />
                </div>
                <Button size="sm" disabled={busy} onClick={() => void assignUser(true)}>
                  Přidělit licenci
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void assignUser(false)}>
                  Odebrat licenci
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
