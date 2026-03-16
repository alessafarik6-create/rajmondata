
"use client";
import { Badge } from "@/components/ui/badge";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { 
  Settings, 
  Smartphone, 
  Tablet, 
  ShieldCheck, 
  Save, 
  ChevronLeft,
  Loader2,
  Plus,
  Trash2,
  Activity
} from 'lucide-react';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, addDoc, serverTimestamp, deleteDoc, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function TerminalSettingsPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const router = useRouter();

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);
  const companyId = profile?.companyId;

  const isAdmin = profile?.role === 'owner' || profile?.role === 'admin';

  const terminalsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'attendance_terminals');
  }, [firestore, companyId]);

  const { data: terminals, isLoading } = useCollection(terminalsQuery);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newTerminal, setNewTerminal] = useState({
    terminalName: '',
    mode: 'user_login',
    allowBreaks: true,
    isActive: true
  });

  const handleCreateTerminal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId) return;
    setIsSubmitting(true);

    try {
      const colRef = collection(firestore, 'companies', companyId, 'attendance_terminals');
      await addDoc(colRef, {
        ...newTerminal,
        organizationId: companyId,
        createdAt: serverTimestamp()
      });

      toast({ title: "Terminál přidán", description: `Terminál ${newTerminal.terminalName} byl úspěšně nakonfigurován.` });
      setNewTerminal({ terminalName: '', mode: 'user_login', allowBreaks: true, isActive: true });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteTerminal = async (id: string) => {
    if (!confirm('Opravdu chcete tento terminál smazat?')) return;
    try {
      await deleteDoc(doc(firestore, 'companies', companyId!, 'attendance_terminals', id));
      toast({ title: "Terminál odstraněn" });
    } catch (e) {
      toast({ variant: "destructive", title: "Chyba při mazání" });
    }
  };

  const toggleStatus = async (id: string, current: boolean) => {
    try {
      await updateDoc(doc(firestore, 'companies', companyId!, 'attendance_terminals', id), {
        isActive: !current
      });
    } catch (e) {
      toast({ variant: "destructive", title: "Chyba" });
    }
  };

  if (!isAdmin && profile) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <ShieldCheck className="w-16 h-16 text-muted-foreground opacity-20" />
        <h2 className="text-2xl font-bold">Přístup odepřen</h2>
        <p className="text-muted-foreground">Tato sekce je určena pouze pro administrátory.</p>
        <Button onClick={() => router.push('/portal/dashboard')}>Zpět na přehled</Button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-20">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/portal/attendance')}>
          <ChevronLeft className="w-6 h-6" />
        </Button>
        <div>
          <h1 className="portal-page-title">Nastavení terminálů</h1>
          <p className="text-muted-foreground">Konfigurace docházkových bodů pro vaši firmu.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* New Terminal Form */}
        <Card className="bg-surface border-border lg:col-span-1 h-fit">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" /> Nový terminál
            </CardTitle>
            <CardDescription>Definujte nové zařízení pro evidenci docházky.</CardDescription>
          </CardHeader>
          <form onSubmit={handleCreateTerminal}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tname">Název terminálu</Label>
                <Input 
                  id="tname" 
                  placeholder="Např. Hlavní vchod - Tablet" 
                  required
                  value={newTerminal.terminalName}
                  onChange={e => setNewTerminal({...newTerminal, terminalName: e.target.value})}
                  className="bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label>Režim přístupu</Label>
                <Select value={newTerminal.mode} onValueChange={v => setNewTerminal({...newTerminal, mode: v})}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Vyberte režim" />
                  </SelectTrigger>
                  <SelectContent className="bg-surface border-border">
                    <SelectItem value="user_login">Uživatelské přihlášení</SelectItem>
                    <SelectItem value="pin">Rychlý PIN kód (Placeholder)</SelectItem>
                    <SelectItem value="qr">QR kód (Placeholder)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border">
                <Label htmlFor="breaks" className="cursor-pointer">Sledovat přestávky</Label>
                <Switch 
                  id="breaks" 
                  checked={newTerminal.allowBreaks} 
                  onCheckedChange={v => setNewTerminal({...newTerminal, allowBreaks: v})}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={isSubmitting} className="w-full gap-2">
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4" /> Uložit konfiguraci</>}
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* Terminals List */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-surface border-border overflow-hidden">
            <CardHeader className="bg-primary/5 border-b border-primary/10">
              <CardTitle className="text-lg flex items-center gap-2">
                <Tablet className="w-5 h-5 text-primary" /> Aktivní terminály
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
              ) : terminals && terminals.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="pl-6">Název / Umístění</TableHead>
                      <TableHead>Režim</TableHead>
                      <TableHead>Stav</TableHead>
                      <TableHead className="pr-6 text-right">Akce</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {terminals.map((t) => (
                      <TableRow key={t.id} className="border-border hover:bg-muted/30 group">
                        <TableCell className="pl-6">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center text-primary">
                              {t.mode === 'user_login' ? <Smartphone className="w-4 h-4" /> : <Tablet className="w-4 h-4" />}
                            </div>
                            <span className="font-bold">{t.terminalName}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {t.mode === 'user_login' ? 'Uživatel' : t.mode === 'pin' ? 'PIN' : 'QR'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Switch checked={t.isActive} onCheckedChange={() => toggleStatus(t.id, t.isActive)} />
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" onClick={() => deleteTerminal(t.id)} className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-20 text-center text-muted-foreground">
                  <Smartphone className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>Zatím nebyly nastaveny žádné terminály.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" /> Poslední aktivita terminálů
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm p-3 rounded-lg border border-border/50 bg-background/30">
                  <div className="flex gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5" />
                    <div>
                      <p className="font-bold">Sára Millerová</p>
                      <p className="text-xs text-muted-foreground">Příchod přes Mobilní Terminál</p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">před 15m</span>
                </div>
                <div className="flex items-center justify-between text-sm p-3 rounded-lg border border-border/50 bg-background/30">
                  <div className="flex gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5" />
                    <div>
                      <p className="font-bold">Alex Rivera</p>
                      <p className="text-xs text-muted-foreground">Začátek pauzy - Tablet Vchod</p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">před 1h</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
