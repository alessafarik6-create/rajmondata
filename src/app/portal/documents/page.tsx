
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  Plus, 
  FileText, 
  Upload, 
  Download, 
  Filter, 
  Search, 
  Loader2,
  Trash2,
  FileDown
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, addDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

export default function DocumentsPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);
  const companyId = profile?.companyId || 'nebula-tech';

  const documentsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'documents');
  }, [firestore, companyId]);

  const { data: documents, isLoading } = useCollection(documentsQuery);

  const [isAddDocOpen, setIsAddDocOpen] = useState(false);
  const [newDocType, setNewDocType] = useState<'received' | 'issued'>('received');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    number: '',
    entityName: '',
    amount: '',
    vat: '21',
    date: new Date().toISOString().split('T')[0],
    description: ''
  });

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId) return;
    setIsSubmitting(true);

    try {
      const colRef = collection(firestore, 'companies', companyId, 'documents');
      await addDoc(colRef, {
        ...formData,
        type: newDocType,
        amount: Number(formData.amount),
        vat: Number(formData.vat),
        organizationId: companyId,
        createdBy: user?.uid,
        createdAt: serverTimestamp()
      });

      // Update finance module if it's an expense or revenue
      const financeRef = collection(firestore, 'companies', companyId, 'finance');
      await addDoc(financeRef, {
        amount: Number(formData.amount),
        type: newDocType === 'received' ? 'expense' : 'revenue',
        date: formData.date,
        description: `Doklad ${formData.number}: ${formData.description}`,
        createdAt: serverTimestamp()
      });

      toast({ title: "Doklad uložen", description: `Záznam ${formData.number} byl úspěšně přidán.` });
      setIsAddDocOpen(false);
      setFormData({ number: '', entityName: '', amount: '', vat: '21', date: new Date().toISOString().split('T')[0], description: '' });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba", description: "Nepodařilo se uložit doklad." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Opravdu chcete tento doklad odstranit?')) return;
    try {
      await deleteDoc(doc(firestore, 'companies', companyId, 'documents', id));
      toast({ title: "Doklad odstraněn" });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba při mazání" });
    }
  };

  const filteredDocs = (type: string) => documents?.filter(d => d.type === type) || [];

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">Firemní doklady</h1>
          <p className="portal-page-description">Správa přijatých a vydaných dokladů vaší organizace.</p>
        </div>
        <div className="flex flex-wrap gap-2">
        <Dialog open={isAddDocOpen} onOpenChange={setIsAddDocOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 min-h-[44px] w-full sm:w-auto">
              <Plus className="w-4 h-4 shrink-0" /> Přidat doklad
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Nový obchodní doklad</DialogTitle>
                <DialogDescription>Zadejte údaje z faktury nebo účtenky pro evidenci.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddDocument} className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-2">
                    <Label>Typ dokladu</Label>
                    <div className="flex gap-2 p-1 bg-background rounded-lg border border-border">
                      <Button 
                        type="button" 
                        variant={newDocType === 'received' ? 'default' : 'ghost'} 
                        className="flex-1 h-8 text-xs"
                        onClick={() => setNewDocType('received')}
                      >Přijatý (Náklad)</Button>
                      <Button 
                        type="button" 
                        variant={newDocType === 'issued' ? 'default' : 'ghost'} 
                        className="flex-1 h-8 text-xs"
                        onClick={() => setNewDocType('issued')}
                      >Vydaný (Příjem)</Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="number">Číslo dokladu</Label>
                    <Input id="number" required value={formData.number} onChange={e => setFormData({...formData, number: e.target.value})} className="bg-background" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="date">Datum vystavení</Label>
                    <Input id="date" type="date" required value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="bg-background" />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label htmlFor="entityName">{newDocType === 'received' ? 'Dodavatel' : 'Odběratel'}</Label>
                    <Input id="entityName" required value={formData.entityName} onChange={e => setFormData({...formData, entityName: e.target.value})} className="bg-background" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="amount">Částka (včetně DPH)</Label>
                    <Input id="amount" type="number" required value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} className="bg-background" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vat">Sazba DPH (%)</Label>
                    <Input id="vat" type="number" value={formData.vat} onChange={e => setFormData({...formData, vat: e.target.value})} className="bg-background" />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label htmlFor="description">Popis / Poznámka</Label>
                    <Input id="description" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="bg-background" />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={isSubmitting} className="w-full">
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Uložit doklad"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Button variant="outlineLight" className="gap-2 min-h-[44px]">
            <Upload className="w-4 h-4 shrink-0" /> Nahrát PDF
          </Button>
        </div>
      </div>

      <Tabs defaultValue="received" className="w-full min-w-0">
        <TabsList className="flex flex-wrap h-auto gap-1 p-1 mb-6">
          <TabsTrigger value="received" className="gap-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial"><FileText className="w-4 h-4 shrink-0" /> Přijaté doklady</TabsTrigger>
          <TabsTrigger value="issued" className="gap-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial"><FileText className="w-4 h-4 shrink-0 text-emerald-500" /> Vydané doklady</TabsTrigger>
        </TabsList>

        <TabsContent value="received">
          <DocumentTable data={filteredDocs('received')} isLoading={isLoading} onDelete={handleDelete} title="Náklady" />
        </TabsContent>

        <TabsContent value="issued">
          <DocumentTable data={filteredDocs('issued')} isLoading={isLoading} onDelete={handleDelete} title="Příjmy" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DocumentTable({ data, isLoading, onDelete, title }: { data: any[], isLoading: boolean, onDelete: (id: string) => void, title: string }) {
  return (
    <Card className="overflow-hidden min-w-0">
      <div className="p-4 border-b flex flex-col sm:flex-row gap-4 justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Hledat v dokladech..." className="pl-10 min-h-[44px] w-full" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outlineLight" size="sm" className="gap-2 min-h-[44px] sm:min-h-0"><Filter className="w-4 h-4 shrink-0" /> Filtr</Button>
          <Button variant="outlineLight" size="sm" className="gap-2 min-h-[44px] sm:min-h-0"><Download className="w-4 h-4 shrink-0" /> Export</Button>
        </div>
      </div>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="pl-6">Číslo dokladu</TableHead>
                <TableHead>Subjekt</TableHead>
                <TableHead>Datum</TableHead>
                <TableHead className="text-right">Částka</TableHead>
                <TableHead className="pr-6 text-right">Akce</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((doc) => (
                <TableRow key={doc.id} className="border-border hover:bg-muted/30 group">
                  <TableCell className="pl-6 font-medium">
                    <div className="flex items-center gap-2">
                      <FileDown className="w-4 h-4 text-muted-foreground opacity-50" />
                      {doc.number}
                    </div>
                  </TableCell>
                  <TableCell>{doc.entityName}</TableCell>
                  <TableCell>{doc.date}</TableCell>
                  <TableCell className={`text-right font-bold ${doc.type === 'received' ? 'text-rose-500' : 'text-emerald-500'}`}>
                    {doc.amount?.toLocaleString()} Kč
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    <Button variant="ghost" size="icon" onClick={() => onDelete(doc.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-20 text-muted-foreground">Nebyly nalezeny žádné doklady v kategorii {title}.</div>
        )}
      </CardContent>
    </Card>
  );
}
