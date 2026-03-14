
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { 
  Search, 
  Filter, 
  Download, 
  UserPlus, 
  Loader2, 
  MoreVertical,
  Building2,
  Mail,
  Phone,
  Trash2,
  ExternalLink
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, doc, addDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';

export default function CustomersPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);
  const companyId = profile?.companyId || 'nebula-tech';

  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'customers');
  }, [firestore, companyId]);

  const { data: customers, isLoading } = useCollection(customersQuery);

  const [isNewCustomerOpen, setIsNewCustomerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [newCustomer, setNewCustomer] = useState({
    companyName: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    ico: '',
    notes: ''
  });

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId) return;
    setIsSubmitting(true);

    try {
      const colRef = collection(firestore, 'companies', companyId, 'customers');
      await addDoc(colRef, {
        ...newCustomer,
        companyId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      toast({
        title: "Zákazník vytvořen",
        description: `Zákazník ${newCustomer.companyName || newCustomer.lastName} byl úspěšně přidán.`
      });
      setIsNewCustomerOpen(false);
      setNewCustomer({
        companyName: '', firstName: '', lastName: '', email: '', phone: '', address: '', ico: '', notes: ''
      });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba", description: "Nepodařilo se vytvořit zákazníka." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!confirm('Opravdu chcete tohoto zákazníka odstranit?')) return;
    try {
      await deleteDoc(doc(firestore, 'companies', companyId, 'customers', id));
      toast({ title: "Zákazník odstraněn" });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba při mazání" });
    }
  };

  const filteredCustomers = customers?.filter(c => 
    c.companyName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold">Adresář zákazníků</h1>
          <p className="text-muted-foreground mt-2">Spravujte vztahy s klienty a kontaktní informace vaší firmy.</p>
        </div>
        <Dialog open={isNewCustomerOpen} onOpenChange={setIsNewCustomerOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 shadow-lg shadow-primary/20">
              <UserPlus className="w-4 h-4" /> Nový zákazník
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-surface border-border max-w-2xl">
            <DialogHeader>
              <DialogTitle>Přidat nového zákazníka</DialogTitle>
              <DialogDescription>Vyplňte údaje o novém klientovi pro vaši databázi.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateCustomer} className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2 col-span-2 md:col-span-1">
                  <Label htmlFor="companyName">Název firmy / Jméno</Label>
                  <Input 
                    id="companyName" 
                    placeholder="Např. Tech Solutions s.r.o." 
                    value={newCustomer.companyName} 
                    onChange={e => setNewCustomer({...newCustomer, companyName: e.target.value})}
                    className="bg-background"
                  />
                </div>
                <div className="space-y-2 col-span-2 md:col-span-1">
                  <Label htmlFor="ico">IČO</Label>
                  <Input 
                    id="ico" 
                    placeholder="12345678" 
                    value={newCustomer.ico} 
                    onChange={e => setNewCustomer({...newCustomer, ico: e.target.value})}
                    className="bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="firstName">Jméno kontaktní osoby</Label>
                  <Input 
                    id="firstName" 
                    value={newCustomer.firstName} 
                    onChange={e => setNewCustomer({...newCustomer, firstName: e.target.value})}
                    className="bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Příjmení kontaktní osoby</Label>
                  <Input 
                    id="lastName" 
                    required 
                    value={newCustomer.lastName} 
                    onChange={e => setNewCustomer({...newCustomer, lastName: e.target.value})}
                    className="bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input 
                    id="email" 
                    type="email"
                    value={newCustomer.email} 
                    onChange={e => setNewCustomer({...newCustomer, email: e.target.value})}
                    className="bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Telefon</Label>
                  <Input 
                    id="phone" 
                    value={newCustomer.phone} 
                    onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})}
                    className="bg-background"
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="address">Adresa</Label>
                  <Input 
                    id="address" 
                    value={newCustomer.address} 
                    onChange={e => setNewCustomer({...newCustomer, address: e.target.value})}
                    className="bg-background"
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="notes">Poznámky</Label>
                  <Textarea 
                    id="notes" 
                    value={newCustomer.notes} 
                    onChange={e => setNewCustomer({...newCustomer, notes: e.target.value})}
                    className="bg-background"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={isSubmitting} className="w-full">
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Vytvořit zákazníka"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="bg-surface border-border overflow-hidden">
        <div className="p-4 border-b bg-background/30 flex flex-col sm:flex-row gap-4 justify-between">
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Hledat zákazníka..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-background border-border" 
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="w-4 h-4" /> Filtr
            </Button>
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="w-4 h-4" /> Export
            </Button>
          </div>
        </div>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : filteredCustomers && filteredCustomers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="pl-6">Zákazník / Firma</TableHead>
                  <TableHead>Kontakt</TableHead>
                  <TableHead>Lokalita / Adresa</TableHead>
                  <TableHead className="pr-6 text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCustomers.map((cust) => (
                  <TableRow key={cust.id} className="border-border hover:bg-muted/30 group">
                    <TableCell className="pl-6">
                      <div className="flex flex-col">
                        <span className="font-bold text-foreground flex items-center gap-2">
                          <Building2 className="w-3 h-3 text-primary opacity-50 group-hover:opacity-100" />
                          {cust.companyName || `${cust.firstName} ${cust.lastName}`}
                        </span>
                        {cust.ico && <span className="text-[10px] text-muted-foreground uppercase font-mono">IČO: {cust.ico}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col text-sm">
                        <span className="flex items-center gap-1.5"><Mail className="w-3 h-3 text-muted-foreground" /> {cust.email || '-'}</span>
                        <span className="flex items-center gap-1.5 text-muted-foreground text-xs"><Phone className="w-3 h-3" /> {cust.phone || '-'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                      {cust.address || '-'}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <div className="flex justify-end gap-1">
                        <Link href={`/portal/customers/${cust.id}`}>
                          <Button variant="ghost" size="icon" title="Detaily">
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                        </Link>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-surface border-border">
                            <DropdownMenuLabel>Možnosti</DropdownMenuLabel>
                            <DropdownMenuItem asChild>
                               <Link href={`/portal/customers/${cust.id}`}>Zobrazit profil</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem>Upravit údaje</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              className="text-destructive"
                              onClick={() => handleDeleteCustomer(cust.id)}
                            >
                              <Trash2 className="w-4 h-4 mr-2" /> Odstranit
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-20">
              <p className="text-muted-foreground">Žádní zákazníci nebyli nalezeni.</p>
              <Button variant="link" className="text-primary mt-2" onClick={() => setIsNewCustomerOpen(true)}>
                Přidat prvního zákazníka
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
