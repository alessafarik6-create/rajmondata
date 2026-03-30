"use client";

import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Building2,
  Search,
  Loader2,
  MoreVertical,
  Power,
  ExternalLink,
  ShieldCheck,
  TabletSmartphone,
  Copy,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AVAILABLE_MODULES,
  LICENSE_TYPES,
  LICENSE_STATUSES,
  MODULE_KEYS,
  buildCanonicalModulesMapFromEnabled,
  resolveCanonicalModuleMapForAdmin,
  type CanonicalModuleKey,
} from "@/lib/license-modules";
import type { LicenseConfig, ModuleKey } from "@/lib/license-modules";

type Company = {
  id: string;
  name: string;
  email?: string;
  ico?: string;
  ownerUserId?: string;
  isActive: boolean;
  createdAt: string | null;
  licenseId: string;
  license: LicenseConfig & { modules?: Record<string, boolean> };
  modules?: Record<string, boolean>;
  enabledModuleIds?: string[];
};

export default function AdminCompaniesPage() {
  const { toast } = useToast();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [editing, setEditing] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<LicenseConfig | null>(null);
  const [editModuleMap, setEditModuleMap] = useState<Record<CanonicalModuleKey, boolean> | null>(
    null
  );

  const [loadError, setLoadError] = useState<string | null>(null);
  const lastSavedCompanyIdRef = useRef<string | null>(null);

  const [terminalFor, setTerminalFor] = useState<Company | null>(null);
  const [terminalPublicUrl, setTerminalPublicUrl] = useState("");

  const loadCompanies = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (silent) {
      setListRefreshing(true);
    } else {
      setLoading(true);
    }
    setLoadError(null);
    try {
      const res = await fetch("/api/superadmin/companies");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data?.error ||
          (res.status === 503
            ? "Firebase Admin není nakonfigurován. Přidejte FIREBASE_CLIENT_EMAIL a FIREBASE_PRIVATE_KEY do .env.local."
            : "Nepodařilo se načíst organizace.");
        setLoadError(msg);
        setCompanies([]);
        if (res.status !== 503) toast({ variant: "destructive", title: "Chyba", description: msg });
        return;
      }
      const list = (Array.isArray(data) ? data : []) as Company[];
      setCompanies(list);
      if (process.env.NODE_ENV === "development") {
        const sid = lastSavedCompanyIdRef.current;
        if (sid) {
          const row = list.find((c) => c.id === sid) as
            | (Company & { enabledModuleIds?: string[]; modules?: Record<string, boolean> })
            | undefined;
          if (row) {
            const reloaded = resolveCanonicalModuleMapForAdmin({
              license: row.license,
              enabledModuleIds: row.enabledModuleIds,
              modules: row.modules,
            });
            console.log("RELOAD loadedModules", reloaded);
          }
          lastSavedCompanyIdRef.current = null;
        }
      }
    } catch {
      setLoadError("Nepodařilo se načíst organizace.");
      setCompanies([]);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Nepodařilo se načíst organizace.",
      });
    } finally {
      if (silent) {
        setListRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadCompanies();
  }, []);

  const toggleStatus = async (company: Company) => {
    try {
      const res = await fetch(`/api/superadmin/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !company.isActive }),
      });
      if (!res.ok) throw new Error();
      toast({
        title: "Status aktualizován",
        description: `Firma byla ${!company.isActive ? "aktivována" : "deaktivována"}.`,
      });
      await loadCompanies({ silent: true });
    } catch {
      toast({ variant: "destructive", title: "Chyba při aktualizaci" });
    }
  };

  const openEdit = (company: Company) => {
    setEditing(company);
    const exp =
      company.license.expirationDate ??
      (company.license as { licenseExpiresAt?: string | null }).licenseExpiresAt ??
      null;
    const row = company as Company & {
      enabledModuleIds?: string[];
      modules?: Record<string, boolean>;
    };
    const loadedModules = resolveCanonicalModuleMapForAdmin({
      license: row.license,
      enabledModuleIds: row.enabledModuleIds,
      modules: row.modules,
    });
    if (process.env.NODE_ENV === "development") {
      console.log("OPEN loadedModules", { ...loadedModules });
    }
    const enabledKeys = MODULE_KEYS.filter((k) => loadedModules[k]);
    setEditModuleMap({ ...loadedModules });
    setEditForm({
      licenseType: company.license.licenseType,
      status: company.license.status,
      expirationDate: exp,
      maxUsers: company.license.maxUsers,
      enabledModules: [...enabledKeys],
    });
  };

  const saveLicense = async () => {
    if (!editing || !editForm || !editModuleMap) return;
    const selectedModules = MODULE_KEYS.filter((k) => editModuleMap[k]);
    const licensePayload: LicenseConfig = {
      ...editForm,
      enabledModules: selectedModules,
    };
    const payload = { license: licensePayload };
    if (process.env.NODE_ENV === "development") {
      console.log("SAVE selectedModules", selectedModules);
      console.log(
        "SAVE modules map (all keys)",
        buildCanonicalModulesMapFromEnabled(selectedModules)
      );
      console.log("SAVE payload", payload);
      console.log("SAVE companyId", editing.id);
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/superadmin/companies/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof data?.error === "string" ? data.error : "Uložení se nezdařilo.";
        if (process.env.NODE_ENV === "development") console.error("save error", data);
        throw new Error(msg);
      }
      if (process.env.NODE_ENV === "development") {
        console.log("SAVE success");
        const verifyRes = await fetch(`/api/superadmin/companies/${editing.id}`);
        const doc = await verifyRes.json().catch(() => null);
        if (verifyRes.ok && doc && typeof doc === "object") {
          const d = doc as Company & {
            enabledModuleIds?: string[];
            modules?: Record<string, boolean>;
          };
          const fromServer = resolveCanonicalModuleMapForAdmin({
            license: d.license,
            enabledModuleIds: d.enabledModuleIds,
            modules: d.modules,
          });
          console.log("VERIFY Firestore modules map after save", {
            topModules: d.modules,
            licenseModules: d.license?.modules,
            resolved: { ...fromServer },
          });
        }
      }
      toast({ title: "Licence uložena", description: "Změny byly aplikovány." });
      lastSavedCompanyIdRef.current = editing.id;
      setEditing(null);
      setEditForm(null);
      setEditModuleMap(null);
      await loadCompanies({ silent: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chyba při ukládání";
      if (process.env.NODE_ENV === "development") console.error("save error", e);
      toast({ variant: "destructive", title: "Chyba při ukládání", description: msg });
    } finally {
      setSaving(false);
    }
  };

  const toggleModule = (key: ModuleKey) => {
    if (!editForm || !editModuleMap) return;
    if (process.env.NODE_ENV === "development") {
      console.log(
        "TOGGLE before",
        MODULE_KEYS.reduce(
          (acc, k) => {
            acc[k] = editModuleMap[k];
            return acc;
          },
          {} as Record<CanonicalModuleKey, boolean>
        )
      );
      console.log("TOGGLE key", key);
    }
    const nextValue = !editModuleMap[key];
    const nextModules: Record<CanonicalModuleKey, boolean> = {
      ...editModuleMap,
      [key]: nextValue,
    };
    if (process.env.NODE_ENV === "development") {
      console.log("TOGGLE value", nextValue);
      console.log("TOGGLE after", { ...nextModules });
    }
    setEditModuleMap(nextModules);
    setEditForm({
      ...editForm,
      enabledModules: MODULE_KEYS.filter((k) => nextModules[k]),
    });
  };

  useEffect(() => {
    if (terminalFor && typeof window !== "undefined") {
      setTerminalPublicUrl(
        `${window.location.origin}/attendance-login?companyId=${encodeURIComponent(terminalFor.id)}`
      );
    } else {
      setTerminalPublicUrl("");
    }
  }, [terminalFor]);

  const openTerminalDialog = (company: Company) => {
    setTerminalFor(company);
  };

  const copyTerminalUrl = async () => {
    if (!terminalPublicUrl) {
      toast({ variant: "destructive", title: "Není co kopírovat" });
      return;
    }
    try {
      await navigator.clipboard.writeText(terminalPublicUrl);
      toast({ title: "URL zkopírována do schránky" });
    } catch {
      toast({ variant: "destructive", title: "Kopírování se nepodařilo" });
    }
  };

  const openTerminalInNewTab = () => {
    if (!terminalPublicUrl) return;
    window.open(terminalPublicUrl, "_blank", "noopener,noreferrer");
  };

  const filtered = companies.filter(
    (c) =>
      c.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.ico?.includes(searchTerm) ||
      c.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Správa organizací</h1>
        <p className="text-slate-800 mt-1">Přehled všech organizací a jejich licencí.</p>
      </div>

      <Card className="border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row gap-4 justify-between">
          {listRefreshing ? (
            <p className="text-xs text-slate-600 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> aktualizuji seznam…
            </p>
          ) : null}
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-800" />
            <Input
              placeholder="Hledat firmu, IČO, email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-white border-slate-200"
            />
          </div>
        </div>
        <CardContent className="p-0">
          {loadError && (
            <div className="p-4 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm">
              {loadError}
            </div>
          )}
          {loading ? (
            <div className="flex justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : filtered.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 hover:bg-transparent">
                  <TableHead className="pl-4 sm:pl-6">Organizace</TableHead>
                  <TableHead className="hidden lg:table-cell font-mono text-xs">ID</TableHead>
                  <TableHead className="hidden md:table-cell">IČO</TableHead>
                  <TableHead className="hidden md:table-cell">Vytvořeno</TableHead>
                  <TableHead>Licence</TableHead>
                  <TableHead>Moduly</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead className="pr-4 sm:pr-6 text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((company) => (
                  <TableRow key={company.id} className="border-slate-200 hover:bg-slate-50">
                    <TableCell className="pl-4 sm:pl-6 font-medium">
                      <div className="flex flex-col min-w-0">
                        <span className="text-slate-900">{company.name}</span>
                        {company.email && (
                          <span className="text-xs text-slate-800 truncate">{company.email}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-800 hidden lg:table-cell max-w-[120px] truncate" title={company.id}>
                      {company.id}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-800 hidden md:table-cell">
                      {company.ico || "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-slate-800 text-xs">
                      {company.createdAt ? new Date(company.createdAt).toLocaleDateString("cs-CZ") : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-primary/30 text-primary capitalize">
                        {company.licenseId || company.license.licenseType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-800">
                      {(company.license.enabledModules?.length ?? 0)} modulů
                    </TableCell>
                    <TableCell>
                      <Badge variant={company.isActive ? "default" : "secondary"}>
                        {company.isActive ? "Aktivní" : "Neaktivní"}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-4 sm:pr-6 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Správa</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => openEdit(company)}>
                            <ShieldCheck className="w-4 h-4 mr-2" /> Licence a moduly
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void openTerminalDialog(company)}>
                            <TabletSmartphone className="w-4 h-4 mr-2" /> Docházkový terminál
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => window.open(`/portal/dashboard`, "_blank")}
                          >
                            <ExternalLink className="w-4 h-4 mr-2" /> Otevřít portál
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => toggleStatus(company)}>
                            <Power className="w-4 h-4 mr-2" />{" "}
                            {company.isActive ? "Deaktivovat" : "Aktivovat"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-16 text-slate-800">
              <Building2 className="w-12 h-12 mx-auto mb-4 opacity-40" />
              <p>Žádné organizace nenalezeny.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg bg-white border-slate-200 text-slate-900" data-portal-dialog>
          <DialogHeader>
            <DialogTitle>Licence a moduly – {editing?.name}</DialogTitle>
            <DialogDescription>
              Nastavte typ licence, stav a povolené moduly pro tuto organizaci.
            </DialogDescription>
          </DialogHeader>
          {editForm && editModuleMap && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Typ licence</Label>
                  <Select
                    value={editForm.licenseType}
                    onValueChange={(v) =>
                      setEditForm({ ...editForm, licenseType: v as LicenseConfig["licenseType"] })
                    }
                  >
                    <SelectTrigger className="bg-white border-slate-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200">
                      {LICENSE_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Stav licence</Label>
                  <Select
                    value={editForm.status}
                    onValueChange={(v) =>
                      setEditForm({ ...editForm, status: v as LicenseConfig["status"] })
                    }
                  >
                    <SelectTrigger className="bg-white border-slate-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200">
                      {LICENSE_STATUSES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Datum expirace licence (volitelné)</Label>
                  <Input
                    type="date"
                    value={editForm.expirationDate ?? ""}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        expirationDate: e.target.value || null,
                      })
                    }
                    className="bg-white border-slate-200"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max. uživatelé (volitelné)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={editForm.maxUsers ?? ""}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        maxUsers: e.target.value === "" ? null : parseInt(e.target.value, 10),
                      })
                    }
                    className="bg-white border-slate-200"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Povolené moduly</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border border-slate-200 rounded-lg p-3 bg-slate-50/50">
                  {AVAILABLE_MODULES.map((mod) => (
                    <label
                      key={mod.key}
                      className="flex items-start gap-2 cursor-pointer text-sm text-slate-700"
                    >
                      <Switch
                        className="mt-0.5 shrink-0"
                        checked={Boolean(editModuleMap[mod.key])}
                        onCheckedChange={() => toggleModule(mod.key)}
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span>{mod.label}</span>
                        {"adminHint" in mod && mod.adminHint ? (
                          <span className="text-xs font-normal text-slate-500">{mod.adminHint}</span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                setEditForm(null);
                setEditModuleMap(null);
              }}
            >
              Zrušit
            </Button>
            <Button onClick={saveLicense} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!terminalFor}
        onOpenChange={(open) => {
          if (!open) {
            setTerminalFor(null);
          }
        }}
      >
        <DialogContent className="max-w-lg bg-white border-slate-200 text-slate-900" data-portal-dialog>
          <DialogHeader>
            <DialogTitle>Veřejná docházka – {terminalFor?.name}</DialogTitle>
            <DialogDescription>
              Odkaz vede na <code className="text-xs bg-slate-100 px-1 rounded">/attendance-login</code> s ID této
              firmy. Zaměstnanci vybírají profil a zadávají PIN (bez přihlášení do portálu).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>URL pro tablet</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  readOnly
                  value={terminalPublicUrl}
                  placeholder="/attendance-login?companyId=…"
                  className="font-mono text-xs bg-slate-50 border-slate-200"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  disabled={!terminalPublicUrl}
                  onClick={() => void copyTerminalUrl()}
                >
                  <Copy className="w-4 h-4 mr-2" /> Kopírovat
                </Button>
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
              <Button type="button" variant="default" onClick={() => openTerminalInNewTab()} disabled={!terminalPublicUrl}>
                <ExternalLink className="w-4 h-4 mr-2" />
                Otevřít docházku
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
