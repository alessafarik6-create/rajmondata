"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUser } from "@/firebase";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
};

export function ReceivablesExportDialog({ open, onOpenChange, companyId }: Props) {
  const { user } = useUser();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<"receivables" | "payables" | "both">("both");
  const [format, setFormat] = useState<"pdf" | "csv" | "xlsx">("xlsx");
  const [dateField, setDateField] = useState<"issued" | "due">("due");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<string>("all");
  const [partner, setPartner] = useState("");
  const [currency, setCurrency] = useState("");

  const runExport = async () => {
    if (!user || !companyId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams({
        companyId,
        format,
        scope,
        dateField,
        paymentStatus,
      });
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (partner.trim()) params.set("partner", partner.trim());
      if (currency.trim()) params.set("currency", currency.trim().toUpperCase());
      const res = await fetch(`/api/company/documents/receivables-export?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Export selhal.");
      }
      const blob = await res.blob();
      const ext = format === "xlsx" ? "xlsx" : format === "pdf" ? "pdf" : "csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export-${scope}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export dokončen", description: "Soubor byl stažen." });
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Export se nepodařil",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Export pohledávek a závazků</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Rozsah</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="receivables">Export pohledávek</SelectItem>
                <SelectItem value="payables">Export závazků</SelectItem>
                <SelectItem value="both">Export obojího</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Formát</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as typeof format)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Datum podle</Label>
            <Select value={dateField} onValueChange={(v) => setDateField(v as typeof dateField)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="issued">Datum vystavení</SelectItem>
                <SelectItem value="due">Datum splatnosti</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Od</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label>Do</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Stav úhrady</Label>
            <Select value={paymentStatus} onValueChange={setPaymentStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Vše</SelectItem>
                <SelectItem value="paid">Uhrazené</SelectItem>
                <SelectItem value="unpaid">Neuhrazené</SelectItem>
                <SelectItem value="partial">Částečně</SelectItem>
                <SelectItem value="overdue">Po splatnosti</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Partner / IČO / číslo</Label>
            <Input value={partner} onChange={(e) => setPartner(e.target.value)} />
          </div>
          <div>
            <Label>Měna</Label>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="CZK" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Zrušit
          </Button>
          <Button type="button" onClick={() => void runExport()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Stáhnout export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
