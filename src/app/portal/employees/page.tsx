
"use client";

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Plus, Search, Filter, Download, Loader2 } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, doc } from 'firebase/firestore';

export default function EmployeesPage() {
  const { user } = useUser();
  const firestore = useFirestore();

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);

  const companyId = profile?.companyId || 'nebula-tech'; 

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'employees');
  }, [firestore, companyId]);

  const { data: employees, isLoading } = useCollection(employeesQuery);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold">Správa zaměstnanců</h1>
          <p className="text-muted-foreground mt-2">Pracovníci organizace {companyId}.</p>
        </div>
        <div className="flex gap-3">
          <Button className="gap-2">
            <Plus className="w-4 h-4" /> Přidat člena týmu
          </Button>
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
              <Download className="w-4 h-4" /> Exportovat CSV
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
                  <TableHead className="pl-6">Jméno</TableHead>
                  <TableHead>Role ve firmě</TableHead>
                  <TableHead>Pracovní pozice</TableHead>
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
                      {emp.role === 'owner' ? 'Majitel' : 
                       emp.role === 'admin' ? 'Administrátor' : 
                       emp.role === 'manager' ? 'Manažer' : 
                       emp.role === 'accountant' ? 'Účetní' : 'Zaměstnanec'}
                    </TableCell>
                    <TableCell>{emp.jobTitle}</TableCell>
                    <TableCell>
                      <Badge variant={emp.isActive ? 'default' : 'secondary'} className="capitalize">
                        {emp.isActive ? 'Aktivní' : 'Neaktivní'}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <Button variant="ghost" size="sm">Upravit</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-20">
              <p className="text-muted-foreground">V této organizaci zatím nejsou žádní zaměstnanci.</p>
              <Button variant="link" className="text-primary mt-2">Přidat prvního pracovníka</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
