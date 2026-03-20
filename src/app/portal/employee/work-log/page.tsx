"use client";

import React, { useMemo, useState } from "react";
import { format } from "date-fns";
import { cs } from "date-fns/locale";
import {
  useUser,
  useFirestore,
  useDoc,
  useCollection,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import {
  doc,
  collection,
  query,
  where,
  limit,
  addDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { hoursBetween, minutesFromHm } from "@/lib/work-time-block";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Trash2, Merge } from "lucide-react";

type WorkBlock = {
  id: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  hours?: number;
  description?: string;
  employeeId?: string;
  companyId?: string;
  authUserId?: string;
};

export default function EmployeeWorkLogPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { companyName } = useCompany();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile } = useDoc<any>(userRef);
  const companyId = profile?.companyId as string | undefined;
  const employeeId = profile?.employeeId as string | undefined;

  const blocksQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "work_time_blocks"),
      where("employeeId", "==", employeeId),
      limit(500)
    );
  }, [firestore, companyId, employeeId]);

  const { data: blocksRaw = [], isLoading } = useCollection(blocksQuery);

  const blocks = useMemo(() => {
    const list = (blocksRaw as WorkBlock[]).map((b: any) => ({
      ...b,
      id: b.id,
    }));
    list.sort((a, b) => {
      const da = String(a.date || "");
      const db = String(b.date || "");
      if (da !== db) return db.localeCompare(da);
      return String(a.startTime || "").localeCompare(String(b.startTime || ""));
    });
    return list;
  }, [blocksRaw]);

  const [selectedDay, setSelectedDay] = useState<Date | undefined>(new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("10:00");
  const [newDesc, setNewDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [mergeIds, setMergeIds] = useState<Record<string, boolean>>({});

  const datesWithData = useMemo(() => {
    const s = new Set<string>();
    for (const b of blocks) {
      if (b.date) s.add(String(b.date));
    }
    return s;
  }, [blocks]);

  const dayKey = selectedDay ? format(selectedDay, "yyyy-MM-dd") : "";

  const dayBlocks = useMemo(
    () => blocks.filter((b) => b.date === dayKey),
    [blocks, dayKey]
  );

  const openDay = (d: Date | undefined) => {
    setSelectedDay(d);
    if (d) setDialogOpen(true);
  };

  const handleAddBlock = async () => {
    if (!user || !companyId || !employeeId || !dayKey) return;
    const h = hoursBetween(newStart, newEnd);
    if (h <= 0) {
      toast({
        variant: "destructive",
        title: "Neplatný čas",
        description: "Čas „od“ musí být před časem „do“.",
      });
      return;
    }
    setSaving(true);
    try {
      await addDoc(
        collection(firestore, "companies", companyId, "work_time_blocks"),
        {
          companyId,
          employeeId,
          authUserId: user.uid,
          date: dayKey,
          startTime: newStart,
          endTime: newEnd,
          hours: h,
          description: newDesc.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );
      toast({ title: "Záznam uložen" });
      setNewDesc("");
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Nepodařilo se uložit výkaz.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!companyId) return;
    if (!confirm("Smazat tento blok?")) return;
    try {
      await deleteDoc(
        doc(firestore, "companies", companyId, "work_time_blocks", id)
      );
      toast({ title: "Blok smazán" });
    } catch {
      toast({ variant: "destructive", title: "Smazání se nezdařilo" });
    }
  };

  const handleMerge = async () => {
    const ids = Object.keys(mergeIds).filter((k) => mergeIds[k]);
    if (ids.length < 2) {
      toast({
        variant: "destructive",
        title: "Vyberte 2+ bloky",
        description: "Zaškrtněte alespoň dva záznamy ze stejného dne.",
      });
      return;
    }
    const chosen = dayBlocks.filter((b) => ids.includes(b.id));
    if (chosen.length < 2) return;

    const startTime = chosen.reduce((min, b) => {
      const t = b.startTime || "99:99";
      const m = minutesFromHm(t);
      const cur = minutesFromHm(min);
      if (!Number.isFinite(m)) return min;
      if (!Number.isFinite(cur)) return t;
      return m < cur ? t : min;
    }, chosen[0].startTime || "00:00");
    const endTime = chosen.reduce((max, b) => {
      const t = b.endTime || "00:00";
      const m = minutesFromHm(t);
      const cur = minutesFromHm(max);
      if (!Number.isFinite(m)) return max;
      if (!Number.isFinite(cur)) return t;
      return m > cur ? t : max;
    }, chosen[0].endTime || "00:00");
    const h = hoursBetween(startTime, endTime);
    if (h <= 0) {
      toast({
        variant: "destructive",
        title: "Nelze spojit",
        description: "Zkontrolujte časy vybraných bloků.",
      });
      return;
    }
    const description = chosen
      .map((b) => b.description?.trim())
      .filter(Boolean)
      .join(" · ");

    if (!user || !companyId || !employeeId) return;
    setSaving(true);
    try {
      const batch = writeBatch(firestore);
      const newRef = doc(
        collection(firestore, "companies", companyId, "work_time_blocks")
      );
      batch.set(newRef, {
        companyId,
        employeeId,
        authUserId: user.uid,
        date: dayKey,
        startTime,
        endTime,
        hours: h,
        description,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        mergedFrom: ids,
      });
      for (const id of ids) {
        batch.delete(
          doc(firestore, "companies", companyId, "work_time_blocks", id)
        );
      }
      await batch.commit();
      setMergeIds({});
      toast({ title: "Bloky spojeny" });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Sloučení selhalo",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!employeeId) {
    return (
      <div className="max-w-xl text-sm text-slate-600">
        Váš účet nemá propojené <code>employeeId</code>. Kontaktujte administrátora.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="portal-page-title text-2xl sm:text-3xl">Výkaz práce</h1>
        <p className="portal-page-description">
          Kalendář a záznamy po hodinových blocích. {companyName ? companyName : ""}
        </p>
      </div>

      <Card className="bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Vyberte den</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col md:flex-row gap-8">
          <Calendar
            mode="single"
            selected={selectedDay}
            onSelect={(d) => {
              setSelectedDay(d);
              if (d) setDialogOpen(true);
            }}
            locale={cs}
            modifiers={{
              hasData: (date) => datesWithData.has(format(date, "yyyy-MM-dd")),
            }}
            modifiersClassNames={{
              hasData: "bg-primary/15 font-semibold text-primary",
            }}
          />
          <div className="text-sm text-slate-600 flex-1">
            <p>
              Dny se záznamem jsou zvýrazněné. Kliknutím na datum otevřete detail
              dne a přidáte nebo upravíte bloky (spojení více bloků: zaškrtněte je a
              použijte „Spojit vybrané“).
            </p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => openDay(new Date())}
            >
              Dnešní den
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-white text-black border-slate-200">
          <DialogHeader>
            <DialogTitle>
              {selectedDay
                ? format(selectedDay, "d. M. yyyy", { locale: cs })
                : "Den"}
            </DialogTitle>
          </DialogHeader>

          {isLoading ? (
            <Loader2 className="animate-spin w-8 h-8 text-primary" />
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-slate-700">Záznamy ({dayKey})</Label>
                  {Object.values(mergeIds).filter(Boolean).length >= 2 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={handleMerge}
                      disabled={saving}
                      className="gap-1"
                    >
                      <Merge className="w-4 h-4" /> Spojit vybrané
                    </Button>
                  )}
                </div>
                {dayBlocks.length === 0 ? (
                  <p className="text-sm text-slate-500">Žádné bloky.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>Od</TableHead>
                        <TableHead>Do</TableHead>
                        <TableHead>H</TableHead>
                        <TableHead>Popis</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dayBlocks.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell>
                            <Checkbox
                              checked={!!mergeIds[b.id]}
                              onCheckedChange={(c) =>
                                setMergeIds((prev) => ({
                                  ...prev,
                                  [b.id]: c === true,
                                }))
                              }
                            />
                          </TableCell>
                          <TableCell>{b.startTime}</TableCell>
                          <TableCell>{b.endTime}</TableCell>
                          <TableCell>{b.hours}</TableCell>
                          <TableCell className="max-w-[140px] truncate text-slate-600">
                            {b.description || "—"}
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleDelete(b.id)}
                              aria-label="Smazat"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-3">
                <Label className="text-slate-800 font-semibold">
                  Nový blok
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-slate-600">Od</Label>
                    <Input
                      type="time"
                      value={newStart}
                      onChange={(e) => setNewStart(e.target.value)}
                      className="bg-white border-slate-200"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-600">Do</Label>
                    <Input
                      type="time"
                      value={newEnd}
                      onChange={(e) => setNewEnd(e.target.value)}
                      className="bg-white border-slate-200"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-slate-600">Popis práce</Label>
                  <Textarea
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    rows={2}
                    className="bg-white border-slate-200"
                    placeholder="Co jste v daném čase dělali…"
                  />
                </div>
              </div>
            </>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Zavřít
            </Button>
            <Button type="button" onClick={handleAddBlock} disabled={saving}>
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" /> Přidat blok
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
