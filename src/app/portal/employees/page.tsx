"use client";
import { Separator } from "@/components/ui/separator";

import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Plus, 
  Search, 
  Filter, 
  Download, 
  Loader2, 
  MoreVertical, 
  UserPlus,
  Shield,
  UserX,
  Trash2,
  Edit2,
  DollarSign,
  AlertTriangle,
  KeyRound,
  RefreshCw,
  QrCode,
  Eye,
  DownloadCloud
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, doc, deleteDoc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';

export default function EmployeesPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const router = useRouter();

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);

  const companyId = profile?.companyId; 
  const userRole = profile?.role || 'employee';
  
  const canManage = userRole === 'owner' || userRole === 'admin';
  const canView = ['owner', 'admin', 'manager'].includes(userRole);

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'employees');
  }, [firestore, companyId]);

  const { data: employees, isLoading } = useCollection(employeesQuery);

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteData, setInviteData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    role: 'employee',
    jobTitle: '',
    hourlyRate: '500'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [qrEmployee, setQrEmployee] = useState<any | null>(null);

  useEffect(() => {
    if (profile && !canView) {
      toast({ variant: "destructive", title: "Přístup odepřen", description: "Nemáte oprávnění k prohlížení seznamu zaměstnanců." });
      router.push('/portal/dashboard');
    }
  }, [profile, canView, router, toast]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !companyId) return;
    setIsSubmitting(true);
    try {
      const colRef = collection(firestore, 'companies', companyId, 'employees');
      await addDoc(colRef, {
        ...inviteData,
        hourlyRate: Number(inviteData.hourlyRate),
        companyId,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hireDate: new Date().toISOString().split('T')[0],
        attendanceQrId: `QR-${Math.random().toString(36).substring(2, 15)}`
      });
      
      toast({
        title: "Zaměstnanec přidán",
        description: `${inviteData.firstName} byl úspěšně přidán do systému.`
      });
      setIsInviteOpen(false);
      setInviteData({ firstName: '', lastName: '', email: '', role: 'employee', jobTitle: '', hourlyRate: '500' });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Nepodařilo se přidat zaměstnance."
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleEmployeeStatus = async (employeeId: string, currentStatus: boolean) => {
    if (!canManage || !companyId) return;
    try {
      const docRef = doc(firestore, 'companies', companyId, 'employees', employeeId);
      await updateDoc(docRef, { isActive: !currentStatus });
      toast({
        title: "Status aktualizován",
        description: `Zaměstnanec byl ${!currentStatus ? 'aktivován' : 'deaktivován'}.`
      });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba při aktualizaci" });
    }
  };

  const generatePin = async (employeeId: string) => {
    if (!canManage || !companyId) return;
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    try {
      const docRef = doc(firestore, 'companies', companyId, 'employees', employeeId);
      await updateDoc(docRef, { attendancePin: newPin });
      toast({ title: "PIN vygenerován", description: `Nový docházkový PIN pro zaměstnance: ${newPin}` });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba" });
    }
  };

  const generateQrId = async (employeeId: string) => {
    if (!canManage || !companyId) return;
    const newQrId = `QR-${Math.random().toString(36).substring(2, 15)}`;
    try {
      const docRef = doc(firestore, 'companies', companyId, 'employees', employeeId);
      await updateDoc(docRef, { attendanceQrId: newQrId });
      toast({ title: "QR ID vygenerováno", description: "Nový identifikátor pro QR docházku byl vytvořen." });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba" });
    }
  };

  const disablePin = async (employeeId: string) => {
    if (!canManage || !companyId) return;
    try {
      const docRef = doc(firestore, 'companies', companyId, 'employees', employeeId);
      await updateDoc(docRef, { attendancePin: null });
      toast({ title: "PIN deaktivován" });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba" });
    }
  };

  const deleteEmployee = async (employeeId: string) => {
    if (!canManage || !companyId) return;
    if (!confirm('Opravdu chcete tohoto zaměstnance odstranit?')) return;
    try {
      const docRef = doc(firestore, 'companies', companyId, 'employees', employeeId);
      await deleteDoc(docRef);
      toast({ title: "Zaměstnanec odstraněn" });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba při mazání" });
    }
  };

  const changeRole = async (employeeId: string, newRole: string) => {
    if (!canManage || !companyId) return;
    try {
      const docRef = doc(firestore, 'companies', companyId, 'employees', employeeId);
      await updateDoc(docRef, { role: newRole });
      toast({ title: "Role změněna", description: `Nová role: ${newRole}` });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba při změně role" });
    }
  };

  if (!canView && profile) return null;

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold">Správa zaměstnanců</h1>
          <p className="text-muted-foreground mt-2">Pracovníci organizace {companyId}.</p>
        </div>
        <div className="flex gap-3">
          {canManage && (
            <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 shadow-lg shadow-primary/20">
                  <UserPlus className="w-4 h-4" /> Pozvat zaměstnance
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-surface border-border max-w-xl">
                <DialogHeader>
                  <DialogTitle>Pozvat nového člena týmu</DialogTitle>
                  <DialogDescription>
                    Vyplňte údaje pro vytvoření profilu zaměstnance a nastavení jeho mzdových nákladů.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleInvite} className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">Jméno</Label>
                      <Input 
                        id="firstName" 
                        required 
                        value={inviteData.firstName} 
                        onChange={e => setInviteData({...inviteData, firstName: e.target.value})}
                        className="bg-background"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Příjmení</Label>
                      <Input 
                        id="lastName" 
                        required 
                        value={inviteData.lastName} 
                        onChange={e => setInviteData({...inviteData, lastName: e.target.value})}
                        className="bg-background"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input 
                      id="email" 
                      type="email" 
                      required 
                      value={inviteData.email} 
                      onChange={e => setInviteData({...inviteData, email: e.target.value})}
                      className="bg-background"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="role">Role</Label>
                      <Select value={inviteData.role} onValueChange={v => setInviteData({...inviteData, role: v})}>
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Vyberte roli" />
                        </SelectTrigger>
                        <SelectContent className="bg-surface border-border">
                          <SelectItem value="admin">Administrátor</SelectItem>
                          <SelectItem value="manager">Manažer</SelectItem>
                          <SelectItem value="accountant">Účetní</SelectItem>
                          <SelectItem value="employee">Zaměstnanec</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="jobTitle">Pracovní pozice</Label>
                      <Input 
                        id="jobTitle" 
                        placeholder="Např. Svářeč" 
                        value={inviteData.jobTitle} 
                        onChange={e => setInviteData({...inviteData, jobTitle: e.target.value})}
                        className="bg-background"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hourlyRate">Hodinová sazba (Kč/h)</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input 
                        id="hourlyRate" 
                        type="number"
                        placeholder="500" 
                        value={inviteData.hourlyRate} 
                        onChange={e => setInviteData({...inviteData, hourlyRate: e.target.value})}
                        className="bg-background pl-10"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">Tato sazba se používá pro výpočet finančních nákladů firmy.</p>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={isSubmitting} className="w-full">
                      {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Vytvořit profil"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Card className="bg-surface border-border overflow-hidden">
        <div className="p-4 border-b bg-background/30 flex flex-col sm:flex-row gap-4 justify-between">
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Hledat jméno nebo email..." className="pl-10 bg-background border-border" />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="w-4 h-4" /> Filtr
            </Button>
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="w-4 h-4" /> Exportovat
            </Button>
          </div>
        </div>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : employees && employees.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="pl-6">Zaměstnanec</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Identifikace (PIN/QR)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6 text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((emp) => (
                  <TableRow key={emp.id} className="border-border hover:bg-muted/30">
                    <TableCell className="pl-6 font-medium">
                      <div className="flex flex-col">
                        <span>{emp.firstName} {emp.lastName}</span>
                        <span className="text-xs text-muted-foreground font-normal">{emp.email}</span>
                      </div>
                    </TableCell>
                    <TableCell className="capitalize">
                      <Badge variant="outline" className="border-primary/30 text-primary">
                        {emp.role === 'owner' ? 'Majitel' : 
                         emp.role === 'admin' ? 'Administrátor' : 
                         emp.role === 'manager' ? 'Manažer' : 
                         emp.role === 'accountant' ? 'Účetní' : 'Zaměstnanec'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          {emp.attendancePin ? (
                            <div className="flex items-center gap-1.5 text-[10px] text-emerald-500 font-bold uppercase">
                              <KeyRound className="w-3 h-3" /> {emp.attendancePin}
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground uppercase">Bez PINu</span>
                          )}
                          <Separator orientation="vertical" className="h-3 mx-1" />
                          {emp.attendanceQrId ? (
                            <Button 
                              variant="ghost" 
                              className="h-auto p-0 text-[10px] text-primary font-bold uppercase gap-1"
                              onClick={() => setQrEmployee(emp)}
                            >
                              <QrCode className="w-3 h-3" /> QR aktivní
                            </Button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground uppercase">Bez QR</span>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-muted-foreground">{emp.hourlyRate || 500} Kč/h</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={emp.isActive ? 'default' : 'secondary'} className="capitalize">
                        {emp.isActive ? 'Aktivní' : 'Neaktivní'}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      {canManage ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-surface border-border w-56">
                            <DropdownMenuLabel>Správa uživatele</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => toggleEmployeeStatus(emp.id, emp.isActive)}>
                              <UserX className="w-4 h-4 mr-2" /> {emp.isActive ? 'Deaktivovat' : 'Aktivovat'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase">Identifikace</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => generatePin(emp.id)}>
                              <RefreshCw className="w-4 h-4 mr-2" /> {emp.attendancePin ? 'Resetovat PIN' : 'Generovat PIN'}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                              if (!emp.attendanceQrId) generateQrId(emp.id);
                              setQrEmployee(emp);
                            }}>
                              <QrCode className="w-4 h-4 mr-2" /> {emp.attendanceQrId ? 'Zobrazit QR kód' : 'Generovat QR kód'}
                            </DropdownMenuItem>
                            {emp.attendancePin && (
                              <DropdownMenuItem onClick={() => disablePin(emp.id)} className="text-rose-500">
                                <Shield className="w-4 h-4 mr-2" /> Zakázat PIN
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase">Změnit roli</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => changeRole(emp.id, 'admin')}>Administrátor</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => changeRole(emp.id, 'manager')}>Manažer</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => changeRole(emp.id, 'employee')}>Zaměstnanec</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => deleteEmployee(emp.id)}>
                              <Trash2 className="w-4 h-4 mr-2" /> Odstranit
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <Shield className="w-4 h-4 text-muted-foreground mx-auto opacity-20" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-20">
              <p className="text-muted-foreground">V této organizaci zatím nejsou žádní zaměstnanci.</p>
              {canManage && (
                <Button variant="link" className="text-primary mt-2" onClick={() => setIsNewCustomerOpen(true)}>
                  Přidat prvního pracovníka
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* QR Code Dialog */}
      <Dialog open={!!qrEmployee} onOpenChange={() => setQrEmployee(null)}>
        <DialogContent className="bg-surface border-border max-w-xs sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Docházkový QR kód</DialogTitle>
            <DialogDescription>
              Zaměstnanec: {qrEmployee?.firstName} {qrEmployee?.lastName}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center p-6 bg-white rounded-xl space-y-4">
            {qrEmployee?.attendanceQrId && (
              <QRCodeSVG 
                value={qrEmployee.attendanceQrId} 
                size={200}
                level="H"
                includeMargin={true}
              />
            )}
            <p className="text-black font-mono text-[10px] select-all">{qrEmployee?.attendanceQrId}</p>
          </div>
          <DialogFooter className="sm:justify-center">
            <Button className="w-full gap-2" onClick={() => window.print()}>
              <DownloadCloud className="w-4 h-4" /> Vytisknout kartu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}