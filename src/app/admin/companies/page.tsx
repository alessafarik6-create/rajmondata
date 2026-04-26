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
  Receipt,
  Trash2,
  Sparkles,
  Repeat,
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
import { Textarea } from "@/components/ui/textarea";
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
  billingAutomation?: Record<string, unknown> | null;
  employeeCount?: number;
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

  type PlatformInvoiceLineForm = {
    kind: string;
    description: string;
    quantity: number;
    unit: string;
    unitPriceNet: number;
    vatRate: number;
  };

  const defaultBillingPeriod = () => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      periodFrom: from.toISOString().slice(0, 10),
      periodTo: to.toISOString().slice(0, 10),
    };
  };

  const defaultDueDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  };

  const [invoiceFor, setInvoiceFor] = useState<Company | null>(null);
  const [invoicePeriodFrom, setInvoicePeriodFrom] = useState("");
  const [invoicePeriodTo, setInvoicePeriodTo] = useState("");
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [invoiceIssueDate, setInvoiceIssueDate] = useState("");
  const [invoiceNote, setInvoiceNote] = useState("");
  const [invoiceLines, setInvoiceLines] = useState<PlatformInvoiceLineForm[]>([]);
  const [invoiceSubmitting, setInvoiceSubmitting] = useState(false);

  const [licenseFromFor, setLicenseFromFor] = useState<Company | null>(null);
  const [licenseFromPeriodFrom, setLicenseFromPeriodFrom] = useState("");
  const [licenseFromPeriodTo, setLicenseFromPeriodTo] = useState("");
  const [licenseFromDueDate, setLicenseFromDueDate] = useState("");
  const [licenseFromIssueDate, setLicenseFromIssueDate] = useState("");
  const [licenseFromNote, setLicenseFromNote] = useState("");
  const [licenseFromPreview, setLicenseFromPreview] = useState<{
    employeeCount: number;
    items: Array<Record<string, unknown>>;
    amountNet: number;
    vatAmount: number;
    amountGross: number;
  } | null>(null);
  const [licenseFromLoading, setLicenseFromLoading] = useState(false);
  const [licenseFromSubmitting, setLicenseFromSubmitting] = useState(false);
  const [licenseFromExtraLines, setLicenseFromExtraLines] = useState<PlatformInvoiceLineForm[]>([]);

  const [automationFor, setAutomationFor] = useState<Company | null>(null);
  const [automationSaving, setAutomationSaving] = useState(false);
  const [automationForm, setAutomationForm] = useState({
    enabled: false,
    intervalDays: 30,
    nextIssueDate: "",
    dueDays: 14,
    sendEmail: false,
  });

  const loadCompanies = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (silent) {
      setListRefreshing(true);
    } else {
      setLoading(true);
    }
    setLoadError(null);
    try {
      const q = silent ? "?light=1" : "";
      const res = await fetch(`/api/superadmin/companies${q}`);
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

  const openPlatformInvoiceDialog = (company: Company) => {
    const p = defaultBillingPeriod();
    setInvoiceFor(company);
    setInvoicePeriodFrom(p.periodFrom);
    setInvoicePeriodTo(p.periodTo);
    setInvoiceDueDate(defaultDueDate());
    setInvoiceIssueDate(new Date().toISOString().slice(0, 10));
    setInvoiceNote("");
    setInvoiceLines([
      {
        kind: "platform_license",
        description: "Licence platformy",
        quantity: 1,
        unit: "měs.",
        unitPriceNet: 0,
        vatRate: 21,
      },
    ]);
  };

  const addInvoicePreset = (kind: PlatformInvoiceLineForm["kind"]) => {
    const presets: Record<string, Omit<PlatformInvoiceLineForm, "kind"> & { kind: string }> = {
      platform_license: {
        kind: "platform_license",
        description: "Licence platformy",
        quantity: 1,
        unit: "měs.",
        unitPriceNet: 0,
        vatRate: 21,
      },
      modules: {
        kind: "modules",
        description: "Moduly platformy",
        quantity: 1,
        unit: "měs.",
        unitPriceNet: 0,
        vatRate: 21,
      },
      employees: {
        kind: "employees",
        description: "Uživatelské účty / zaměstnanci",
        quantity: 1,
        unit: "ks",
        unitPriceNet: 0,
        vatRate: 21,
      },
      custom: {
        kind: "custom",
        description: "Vlastní položka",
        quantity: 1,
        unit: "ks",
        unitPriceNet: 0,
        vatRate: 21,
      },
    };
    const row = presets[kind];
    if (row) setInvoiceLines((prev) => [...prev, { ...row }]);
  };

  const updateInvoiceLine = (index: number, patch: Partial<PlatformInvoiceLineForm>) => {
    setInvoiceLines((prev) => {
      const next = [...prev];
      const cur = next[index];
      if (!cur) return prev;
      next[index] = { ...cur, ...patch };
      return next;
    });
  };

  const removeInvoiceLine = (index: number) => {
    setInvoiceLines((prev) => prev.filter((_, i) => i !== index));
  };

  const submitPlatformInvoice = async () => {
    if (!invoiceFor) return;
    if (!invoicePeriodFrom || !invoicePeriodTo || !invoiceDueDate) {
      toast({ variant: "destructive", title: "Vyplňte období a splatnost" });
      return;
    }
    if (invoiceLines.length === 0) {
      toast({ variant: "destructive", title: "Přidejte alespoň jednu položku" });
      return;
    }
    for (const ln of invoiceLines) {
      if (!String(ln.description || "").trim()) {
        toast({ variant: "destructive", title: "Každá položka musí mít popis" });
        return;
      }
      if (!(ln.quantity > 0) || ln.unitPriceNet < 0 || !(ln.vatRate >= 0)) {
        toast({ variant: "destructive", title: "Zkontrolujte množství, cenu a DPH u položek" });
        return;
      }
    }
    setInvoiceSubmitting(true);
    try {
      const res = await fetch("/api/superadmin/platform-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: invoiceFor.id,
          periodFrom: invoicePeriodFrom,
          periodTo: invoicePeriodTo,
          dueDate: invoiceDueDate,
          issueDate: invoiceIssueDate.trim() || undefined,
          note: invoiceNote.trim() || undefined,
          items: invoiceLines.map((ln) => ({
            kind: ln.kind,
            description: ln.description.trim(),
            quantity: ln.quantity,
            unit: ln.unit.trim() || "ks",
            unitPriceNet: ln.unitPriceNet,
            vatRate: ln.vatRate,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Fakturu se nepodařilo vystavit",
          description: typeof data?.error === "string" ? data.error : undefined,
        });
        return;
      }
      toast({
        title: "Faktura vystavena",
        description: data?.invoiceNumber ? `Číslo: ${data.invoiceNumber}` : undefined,
      });
      if (typeof data?.pdfUrl === "string" && data.pdfUrl) {
        window.open(data.pdfUrl, "_blank", "noopener,noreferrer");
      }
      setInvoiceFor(null);
    } catch {
      toast({ variant: "destructive", title: "Chyba při vystavení faktury" });
    } finally {
      setInvoiceSubmitting(false);
    }
  };

  const openLicenseFromDialog = (company: Company) => {
    const p = defaultBillingPeriod();
    setLicenseFromFor(company);
    setLicenseFromPeriodFrom(p.periodFrom);
    setLicenseFromPeriodTo(p.periodTo);
    setLicenseFromDueDate(defaultDueDate());
    setLicenseFromIssueDate(new Date().toISOString().slice(0, 10));
    setLicenseFromNote("");
    setLicenseFromPreview(null);
    setLicenseFromExtraLines([]);
  };

  const runLicensePreview = async () => {
    if (!licenseFromFor) return;
    if (!licenseFromPeriodFrom || !licenseFromPeriodTo) {
      toast({ variant: "destructive", title: "Vyplňte fakturační období" });
      return;
    }
    setLicenseFromLoading(true);
    try {
      const res = await fetch("/api/superadmin/platform-invoices/preview-from-license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: licenseFromFor.id,
          periodFrom: licenseFromPeriodFrom,
          periodTo: licenseFromPeriodTo,
          extraItems: licenseFromExtraLines.map((ln) => ({
            kind: ln.kind,
            description: ln.description.trim(),
            quantity: ln.quantity,
            unit: ln.unit.trim() || "ks",
            unitPriceNet: ln.unitPriceNet,
            vatRate: ln.vatRate,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Náhled se nepodařil",
          description: typeof data?.error === "string" ? data.error : undefined,
        });
        setLicenseFromPreview(null);
        return;
      }
      setLicenseFromPreview({
        employeeCount: Number(data.employeeCount) || 0,
        items: Array.isArray(data.items) ? data.items : [],
        amountNet: Number(data.amountNet) || 0,
        vatAmount: Number(data.vatAmount) || 0,
        amountGross: Number(data.amountGross) || 0,
      });
    } finally {
      setLicenseFromLoading(false);
    }
  };

  const submitLicenseFromInvoice = async () => {
    if (!licenseFromFor) return;
    if (!licenseFromPreview) {
      toast({ variant: "destructive", title: "Nejdříve načtěte náhled z licence" });
      return;
    }
    if (!licenseFromDueDate) {
      toast({ variant: "destructive", title: "Vyplňte splatnost" });
      return;
    }
    setLicenseFromSubmitting(true);
    try {
      const res = await fetch("/api/superadmin/platform-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: licenseFromFor.id,
          periodFrom: licenseFromPeriodFrom,
          periodTo: licenseFromPeriodTo,
          dueDate: licenseFromDueDate,
          issueDate: licenseFromIssueDate.trim() || undefined,
          note: licenseFromNote.trim() || undefined,
          autoFromLicense: true,
          extraItems: licenseFromExtraLines.map((ln) => ({
            kind: ln.kind,
            description: ln.description.trim(),
            quantity: ln.quantity,
            unit: ln.unit.trim() || "ks",
            unitPriceNet: ln.unitPriceNet,
            vatRate: ln.vatRate,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Fakturu se nepodařilo vystavit",
          description: typeof data?.error === "string" ? data.error : undefined,
        });
        return;
      }
      toast({
        title: "Faktura z licence vystavena",
        description: data?.invoiceNumber ? `Číslo: ${data.invoiceNumber}` : undefined,
      });
      if (typeof data?.pdfUrl === "string" && data.pdfUrl) {
        window.open(data.pdfUrl, "_blank", "noopener,noreferrer");
      }
      setLicenseFromFor(null);
      setLicenseFromPreview(null);
    } catch {
      toast({ variant: "destructive", title: "Chyba při vystavení faktury" });
    } finally {
      setLicenseFromSubmitting(false);
    }
  };

  const openAutomationDialog = async (company: Company) => {
    setAutomationFor(company);
    let defInterval = 30;
    let defDue = 14;
    try {
      const pr = await fetch("/api/superadmin/platform-pricing", { credentials: "include", cache: "no-store" });
      const pj = await pr.json().catch(() => ({}));
      if (typeof pj.automationDefaultIntervalDays === "number") defInterval = pj.automationDefaultIntervalDays;
      if (typeof pj.automationDefaultDueDays === "number") defDue = pj.automationDefaultDueDays;
    } catch {
      /* výchozí zůstanou */
    }
    try {
      const res = await fetch(`/api/superadmin/companies/${encodeURIComponent(company.id)}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      const ba = (data?.billingAutomation ?? {}) as Record<string, unknown>;
      setAutomationForm({
        enabled: ba.enabled === true,
        intervalDays: Math.max(1, Number(ba.intervalDays) || defInterval),
        nextIssueDate:
          typeof ba.nextIssueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ba.nextIssueDate)
            ? ba.nextIssueDate.slice(0, 10)
            : "",
        dueDays: Math.max(1, Number(ba.dueDays) || defDue),
        sendEmail: ba.sendEmail === true,
      });
    } catch {
      setAutomationForm({
        enabled: false,
        intervalDays: defInterval,
        nextIssueDate: "",
        dueDays: defDue,
        sendEmail: false,
      });
    }
  };

  const saveAutomation = async () => {
    if (!automationFor) return;
    setAutomationSaving(true);
    try {
      const res = await fetch(`/api/superadmin/companies/${encodeURIComponent(automationFor.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billingAutomation: {
            enabled: automationForm.enabled,
            intervalDays: automationForm.intervalDays,
            nextIssueDate: automationForm.nextIssueDate || null,
            dueDays: automationForm.dueDays,
            sendEmail: automationForm.sendEmail,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Uložení se nezdařilo",
          description: typeof data?.error === "string" ? data.error : undefined,
        });
        return;
      }
      toast({ title: "Automatická fakturace uložena" });
      setAutomationFor(null);
      await loadCompanies({ silent: true });
    } catch {
      toast({ variant: "destructive", title: "Chyba při ukládání" });
    } finally {
      setAutomationSaving(false);
    }
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
                          <DropdownMenuItem onClick={() => openPlatformInvoiceDialog(company)}>
                            <Receipt className="w-4 h-4 mr-2" /> Vystavit fakturu (ručně)
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openLicenseFromDialog(company)}>
                            <Sparkles className="w-4 h-4 mr-2" /> Vystavit fakturu z licence
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void openAutomationDialog(company)}>
                            <Repeat className="w-4 h-4 mr-2" /> Automatická fakturace
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => window.open(`/portal/dashboard`, "_blank")}
                          >
                            <ExternalLink className="w-4 h-4 mr-2" /> Otevřít portál
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => toggleStatus(company)}>
                            <Power className="w-4 h-4 mr-2" />{" "}
                            {company.isActive ? "Deaktivovat účet" : "Aktivovat účet"}
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
        open={!!invoiceFor}
        onOpenChange={(open) => {
          if (!open) setInvoiceFor(null);
        }}
      >
        <DialogContent
          className="max-w-3xl max-h-[min(90vh,880px)] overflow-y-auto bg-white border-slate-200 text-slate-900"
          data-portal-dialog
        >
          <DialogHeader>
            <DialogTitle>Ruční faktura — {invoiceFor?.name}</DialogTitle>
            <DialogDescription>
              Položky zadáváte ručně. Ceny modulů a základní licence se načítají z ceníku v sekci Ceník / Moduly při
              volbě „Vystavit fakturu z licence“.
            </DialogDescription>
          </DialogHeader>
          {invoiceFor ? (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Období od</Label>
                  <Input
                    type="date"
                    value={invoicePeriodFrom}
                    onChange={(e) => setInvoicePeriodFrom(e.target.value)}
                    className="bg-white border-slate-200"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Období do</Label>
                  <Input
                    type="date"
                    value={invoicePeriodTo}
                    onChange={(e) => setInvoicePeriodTo(e.target.value)}
                    className="bg-white border-slate-200"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Datum vystavení</Label>
                  <Input
                    type="date"
                    value={invoiceIssueDate}
                    onChange={(e) => setInvoiceIssueDate(e.target.value)}
                    className="bg-white border-slate-200"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Splatnost</Label>
                  <Input
                    type="date"
                    value={invoiceDueDate}
                    onChange={(e) => setInvoiceDueDate(e.target.value)}
                    className="bg-white border-slate-200"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Poznámka na faktuře (volitelně)</Label>
                <Textarea
                  value={invoiceNote}
                  onChange={(e) => setInvoiceNote(e.target.value)}
                  rows={2}
                  className="bg-white border-slate-200 resize-none"
                  placeholder="Text se zobrazí na PDF…"
                />
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <span className="text-sm text-slate-600 w-full sm:w-auto sm:mr-2 self-center">Přidat řádek:</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => addInvoicePreset("platform_license")}>
                    Licence
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => addInvoicePreset("modules")}>
                    Moduly
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => addInvoicePreset("employees")}>
                    Zaměstnanci
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => addInvoicePreset("custom")}>
                    Vlastní
                  </Button>
                </div>
                <div className="rounded-lg border border-slate-200 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="min-w-[200px]">Popis</TableHead>
                        <TableHead className="w-20">Množ.</TableHead>
                        <TableHead className="w-24">Jedn.</TableHead>
                        <TableHead className="w-28">Cena bez DPH</TableHead>
                        <TableHead className="w-20">DPH %</TableHead>
                        <TableHead className="w-12 pr-2" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoiceLines.map((ln, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <Input
                              value={ln.description}
                              onChange={(e) => updateInvoiceLine(idx, { description: e.target.value })}
                              className="bg-white border-slate-200 h-9"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0.01}
                              step={0.01}
                              value={ln.quantity}
                              onChange={(e) =>
                                updateInvoiceLine(idx, { quantity: parseFloat(e.target.value) || 0 })
                              }
                              className="bg-white border-slate-200 h-9"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={ln.unit}
                              onChange={(e) => updateInvoiceLine(idx, { unit: e.target.value })}
                              className="bg-white border-slate-200 h-9"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              step={0.01}
                              value={ln.unitPriceNet}
                              onChange={(e) =>
                                updateInvoiceLine(idx, { unitPriceNet: parseFloat(e.target.value) || 0 })
                              }
                              className="bg-white border-slate-200 h-9"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              step={1}
                              value={ln.vatRate}
                              onChange={(e) =>
                                updateInvoiceLine(idx, { vatRate: parseFloat(e.target.value) || 0 })
                              }
                              className="bg-white border-slate-200 h-9"
                            />
                          </TableCell>
                          <TableCell className="pr-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 text-slate-500"
                              onClick={() => removeInvoiceLine(idx)}
                              disabled={invoiceLines.length <= 1}
                              aria-label="Odstranit řádek"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setInvoiceFor(null)} disabled={invoiceSubmitting}>
              Zrušit
            </Button>
            <Button type="button" onClick={() => void submitPlatformInvoice()} disabled={invoiceSubmitting}>
              {invoiceSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Generuji PDF…
                </>
              ) : (
                "Vystavit fakturu"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!licenseFromFor}
        onOpenChange={(open) => {
          if (!open) {
            setLicenseFromFor(null);
            setLicenseFromPreview(null);
          }
        }}
      >
        <DialogContent
          className="max-w-3xl max-h-[min(92vh,900px)] overflow-y-auto bg-white border-slate-200 text-slate-900"
          data-portal-dialog
        >
          <DialogHeader>
            <DialogTitle>Faktura z licence — {licenseFromFor?.name}</DialogTitle>
            <DialogDescription>
              Položky se dopočítají z aktivní licence, modulů a ceníku (platform_settings/pricing a platform_modules).
              Po načtení náhledu můžete doplnit vlastní řádky a znovu přepočítat.
            </DialogDescription>
          </DialogHeader>
          {licenseFromFor ? (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Období od</Label>
                  <Input
                    type="date"
                    value={licenseFromPeriodFrom}
                    onChange={(e) => setLicenseFromPeriodFrom(e.target.value)}
                    className="bg-white border-slate-200"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Období do</Label>
                  <Input
                    type="date"
                    value={licenseFromPeriodTo}
                    onChange={(e) => setLicenseFromPeriodTo(e.target.value)}
                    className="bg-white border-slate-200"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Datum vystavení</Label>
                  <Input
                    type="date"
                    value={licenseFromIssueDate}
                    onChange={(e) => setLicenseFromIssueDate(e.target.value)}
                    className="bg-white border-slate-200"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Splatnost</Label>
                  <Input
                    type="date"
                    value={licenseFromDueDate}
                    onChange={(e) => setLicenseFromDueDate(e.target.value)}
                    className="bg-white border-slate-200"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Poznámka (volitelně)</Label>
                <Textarea
                  value={licenseFromNote}
                  onChange={(e) => setLicenseFromNote(e.target.value)}
                  rows={2}
                  className="bg-white border-slate-200 resize-none"
                />
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <Button type="button" variant="secondary" onClick={() => void runLicensePreview()} disabled={licenseFromLoading}>
                  {licenseFromLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Načíst / přepočítat náhled
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setLicenseFromExtraLines((prev) => [
                      ...prev,
                      {
                        kind: "custom",
                        description: "Vlastní položka",
                        quantity: 1,
                        unit: "ks",
                        unitPriceNet: 0,
                        vatRate: 21,
                      },
                    ])
                  }
                >
                  Přidat vlastní řádek
                </Button>
              </div>
              {licenseFromExtraLines.length > 0 ? (
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <p className="text-sm font-medium text-slate-800">Vlastní položky (před přepočtem náhledu)</p>
                  {licenseFromExtraLines.map((ln, idx) => (
                    <div key={idx} className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
                      <Input
                        className="sm:col-span-2 bg-white border-slate-200"
                        value={ln.description}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLicenseFromExtraLines((p) => p.map((x, i) => (i === idx ? { ...x, description: v } : x)));
                        }}
                      />
                      <Input
                        type="number"
                        className="bg-white border-slate-200"
                        value={ln.quantity}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value) || 0;
                          setLicenseFromExtraLines((p) => p.map((x, i) => (i === idx ? { ...x, quantity: v } : x)));
                        }}
                      />
                      <Input
                        type="number"
                        className="bg-white border-slate-200"
                        value={ln.unitPriceNet}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value) || 0;
                          setLicenseFromExtraLines((p) => p.map((x, i) => (i === idx ? { ...x, unitPriceNet: v } : x)));
                        }}
                      />
                      <Button type="button" variant="ghost" size="sm" onClick={() => setLicenseFromExtraLines((p) => p.filter((_, i) => i !== idx))}>
                        Odstranit
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
              {licenseFromPreview ? (
                <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                  <p className="text-sm text-slate-800">
                    Počet zaměstnanců v účtování modulu docházky:{" "}
                    <strong>{licenseFromPreview.employeeCount}</strong>
                  </p>
                  <div className="overflow-x-auto border border-slate-200 rounded-md bg-white">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Popis</TableHead>
                          <TableHead className="text-right">Množ.</TableHead>
                          <TableHead className="text-right">Cena bez DPH</TableHead>
                          <TableHead className="text-right">DPH %</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {licenseFromPreview.items.map((it, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-sm">{String(it.description ?? "")}</TableCell>
                            <TableCell className="text-right tabular-nums">{String(it.quantity ?? "")}</TableCell>
                            <TableCell className="text-right tabular-nums">{String(it.unitPriceNet ?? "")}</TableCell>
                            <TableCell className="text-right">{String(it.vatRate ?? "")}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="text-sm text-slate-800">
                    Celkem bez DPH: <strong>{licenseFromPreview.amountNet.toFixed(2)} Kč</strong>, DPH:{" "}
                    <strong>{licenseFromPreview.vatAmount.toFixed(2)} Kč</strong>, <strong>včetně DPH: {licenseFromPreview.amountGross.toFixed(2)} Kč</strong>
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate-600">Klikněte na „Načíst / přepočítat náhled“.</p>
              )}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setLicenseFromFor(null)} disabled={licenseFromSubmitting}>
              Zrušit
            </Button>
            <Button type="button" onClick={() => void submitLicenseFromInvoice()} disabled={licenseFromSubmitting || !licenseFromPreview}>
              {licenseFromSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Vystavit fakturu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!automationFor}
        onOpenChange={(open) => {
          if (!open) setAutomationFor(null);
        }}
      >
        <DialogContent className="max-w-lg bg-white border-slate-200 text-slate-900" data-portal-dialog>
          <DialogHeader>
            <DialogTitle>Automatická fakturace — {automationFor?.name}</DialogTitle>
            <DialogDescription>
              Cron volá <code className="text-xs bg-slate-100 px-1 rounded">GET /api/cron/platform-billing-automation?secret=…</code>{" "}
              (proměnná CRON_SECRET). Při dosažení data vystavení se vytvoří faktura z licence; duplicita za stejné období
              není povolena. Pro vypršení 48hodinové lhůty po „Zaplatil jsem“ nastavte také{" "}
              <code className="text-xs bg-slate-100 px-1 rounded">GET /api/cron/platform-payment-grace?secret=…</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="ba-en">Zapnuto</Label>
              <Switch
                id="ba-en"
                checked={automationForm.enabled}
                onCheckedChange={(v) => setAutomationForm((f) => ({ ...f, enabled: v }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Interval (dny)</Label>
              <Input
                type="number"
                min={1}
                className="bg-white border-slate-200"
                value={automationForm.intervalDays}
                onChange={(e) =>
                  setAutomationForm((f) => ({ ...f, intervalDays: Math.max(1, parseInt(e.target.value, 10) || 30) }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Další datum vystavení</Label>
              <Input
                type="date"
                className="bg-white border-slate-200"
                value={automationForm.nextIssueDate}
                onChange={(e) => setAutomationForm((f) => ({ ...f, nextIssueDate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Splatnost od vystavení (dny)</Label>
              <Input
                type="number"
                min={1}
                className="bg-white border-slate-200"
                value={automationForm.dueDays}
                onChange={(e) =>
                  setAutomationForm((f) => ({ ...f, dueDays: Math.max(1, parseInt(e.target.value, 10) || 14) }))
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="ba-mail">Poslat e-mail organizaci po vystavení</Label>
              <Switch
                id="ba-mail"
                checked={automationForm.sendEmail}
                onCheckedChange={(v) => setAutomationForm((f) => ({ ...f, sendEmail: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAutomationFor(null)} disabled={automationSaving}>
              Zrušit
            </Button>
            <Button onClick={() => void saveAutomation()} disabled={automationSaving}>
              {automationSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
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
