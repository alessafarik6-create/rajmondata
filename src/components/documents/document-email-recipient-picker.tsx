"use client";

import React, { useMemo, useState } from "react";
import type { Firestore } from "firebase/firestore";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useCollection, useMemoFirebase } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { isValidEmailAddress, parseCommaSeparatedEmails } from "@/lib/document-email-outbound";
import {
  DOCUMENT_EMAIL_CONTACT_TYPE_LABELS,
  type DocumentEmailContactRow,
  type DocumentEmailContactType,
  normalizeDocumentEmailContactType,
} from "@/lib/document-email-contacts";
import { Loader2, Plus, Trash2, UserPlus } from "lucide-react";

type Props = {
  firestore: Firestore | null;
  companyId: string;
  /** Aktuální hodnota pole Komu */
  toValue: string;
  onToChange: (next: string) => void;
  /** Doporučené adresy (zákazník, organizace, …) — zobrazí se jako rychlé tlačítka */
  suggestionEmails?: Array<{ email: string; label: string }>;
};

function mergeUniqueToField(current: string, email: string): string {
  const e = email.trim().toLowerCase();
  if (!e) return current;
  const parts = parseCommaSeparatedEmails(current);
  const set = new Set(parts.map((p) => p.trim().toLowerCase()).filter(Boolean));
  if (set.has(e)) return current;
  set.add(e);
  return [...set].join(", ");
}

export function DocumentEmailRecipientPicker({
  firestore,
  companyId,
  toValue,
  onToChange,
  suggestionEmails = [],
}: Props) {
  const { toast } = useToast();
  const q = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "documentEmailContacts"),
      orderBy("label", "asc")
    );
  }, [firestore, companyId]);

  const { data: rawRows, isLoading } = useCollection(q);
  const rows = useMemo(() => {
    const list = Array.isArray(rawRows) ? rawRows : [];
    return list.map((r) => {
      const rec = r as Record<string, unknown> & { id: string };
      return {
        id: rec.id,
        companyId,
        email: String(rec.email ?? "").trim(),
        label: String(rec.label ?? "").trim() || String(rec.email ?? "").trim(),
        contactType: rec.contactType as string | undefined,
      } satisfies DocumentEmailContactRow;
    });
  }, [rawRows, companyId]);

  const [newEmail, setNewEmail] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<DocumentEmailContactType>("other");
  const [saving, setSaving] = useState(false);

  const pickContact = (email: string) => {
    if (!isValidEmailAddress(email)) {
      toast({ variant: "destructive", title: "Neplatný e-mail v adresáři" });
      return;
    }
    onToChange(mergeUniqueToField(toValue, email));
  };

  const saveNew = async () => {
    if (!firestore || !companyId) return;
    const email = newEmail.trim();
    if (!isValidEmailAddress(email)) {
      toast({ variant: "destructive", title: "Zadejte platný e-mail" });
      return;
    }
    const label = newLabel.trim() || email;
    setSaving(true);
    try {
      await addDoc(collection(firestore, "companies", companyId, "documentEmailContacts"), {
        companyId,
        email: email.toLowerCase(),
        label,
        contactType: newType,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Kontakt uložen", description: label });
      setNewEmail("");
      setNewLabel("");
      setNewType("other");
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Uložení se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSaving(false);
    }
  };

  const removeRow = async (id: string) => {
    if (!firestore || !companyId) return;
    try {
      await deleteDoc(doc(firestore, "companies", companyId, "documentEmailContacts", id));
      toast({ title: "Kontakt smazán" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Smazání se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    }
  };

  const renameRow = async (row: DocumentEmailContactRow) => {
    const nextLabel = window.prompt("Název kontaktu / štítek", row.label);
    if (nextLabel == null) return;
    const trimmed = nextLabel.trim();
    if (!trimmed) {
      toast({ variant: "destructive", title: "Název nesmí být prázdný" });
      return;
    }
    if (!firestore || !companyId) return;
    try {
      await updateDoc(doc(firestore, "companies", companyId, "documentEmailContacts", row.id), {
        label: trimmed,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Uloženo" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Úprava se nezdařila",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50/80 p-3 text-xs text-gray-800">
      <div className="font-semibold text-gray-900">Adresář příjemců</div>

      {suggestionEmails.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-gray-600">Doporučení</div>
          <div className="flex flex-wrap gap-1">
            {suggestionEmails.map((s) => (
              <Button
                key={`${s.email}-${s.label}`}
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 px-2 text-[11px]"
                disabled={!isValidEmailAddress(s.email)}
                onClick={() => pickContact(s.email)}
                title={s.email}
              >
                {s.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-1">
        <Label className="text-[11px] text-gray-700">Uložené kontakty</Label>
        {isLoading ? (
          <div className="flex items-center gap-2 text-gray-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Načítám…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-[11px] text-gray-600">Zatím žádné uložené adresy.</p>
        ) : (
          <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
            {rows.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-1 rounded border border-gray-200 bg-white px-2 py-1"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-gray-900">{r.label}</div>
                  <div className="truncate text-[11px] text-gray-600">{r.email}</div>
                  {r.contactType ? (
                    <div className="text-[10px] text-gray-500">
                      {DOCUMENT_EMAIL_CONTACT_TYPE_LABELS[
                        normalizeDocumentEmailContactType(String(r.contactType))
                      ] ?? String(r.contactType)}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-1.5 text-[10px]"
                    onClick={() => pickContact(r.email)}
                  >
                    <UserPlus className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5 text-[10px]"
                    onClick={() => void renameRow(r)}
                  >
                    Upravit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1 text-red-700 hover:text-red-800"
                    onClick={() => void removeRow(r.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-gray-200 pt-2">
        <div className="text-[11px] font-medium text-gray-700">Uložit aktuální adresu</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-[10px]">E-mail</Label>
            <Input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="např. ucetni@firma.cz"
              className="h-8 border-gray-300 bg-white text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Název / štítek</Label>
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="např. Účetní"
              className="h-8 border-gray-300 bg-white text-xs"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px]">Typ kontaktu</Label>
          <Select value={newType} onValueChange={(v) => setNewType(v as DocumentEmailContactType)}>
            <SelectTrigger className="h-8 border-gray-300 bg-white text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DOCUMENT_EMAIL_CONTACT_TYPE_LABELS) as DocumentEmailContactType[]).map(
                (k) => (
                  <SelectItem key={k} value={k}>
                    {DOCUMENT_EMAIL_CONTACT_TYPE_LABELS[k]}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 text-xs"
          disabled={saving || !companyId || !firestore}
          onClick={() => void saveNew()}
        >
          {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
          Uložit do adresáře
        </Button>
      </div>
    </div>
  );
}
