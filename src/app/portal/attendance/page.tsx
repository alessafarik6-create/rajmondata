
"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Play, Square, Clock, Calendar as CalendarIcon, Loader2 } from 'lucide-react';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection } from 'firebase/firestore';

export default function AttendancePage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const [activeShift, setActiveShift] = useState(false);
  const [currentTime, setCurrentTime] = useState<string | null>(null);

  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);
  
  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);

  const companyId = profile?.companyId || 'nebula-tech';

  const attendanceQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'attendance');
  }, [firestore, companyId]);

  const { data: historyData, isLoading: isHistoryLoading } = useCollection(attendanceQuery);

  const isAdmin = profile?.globalRoles?.includes('super_admin') || profile?.globalRoles?.includes('admin') || profile?.role === 'owner';

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Moje Docházka</h1>
          <p className="text-muted-foreground mt-2">Zaznamenávejte svůj čas v organizaci {companyId}.</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-mono font-bold text-primary">{currentTime || '--:--:--'}</p>
          <p className="text-sm text-muted-foreground">{new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="bg-surface border-border flex flex-col justify-between shadow-xl">
          <CardHeader>
            <CardTitle>Nahrávání času</CardTitle>
            <CardDescription>Aktuálně jste v systému registrováni jako {profile?.role || 'zaměstnanec'}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col items-center justify-center py-8">
            <div className={`w-36 h-36 rounded-full border-4 flex items-center justify-center mb-6 transition-all ${activeShift ? 'border-primary shadow-2xl shadow-primary/20 animate-pulse' : 'border-muted'}`}>
              <Clock className={`w-14 h-14 ${activeShift ? 'text-primary' : 'text-muted'}`} />
            </div>
            <div className="text-center mb-8">
              <h3 className="text-2xl font-bold">{activeShift ? 'Směna běží' : 'Mimo službu'}</h3>
              <p className="text-muted-foreground">{activeShift ? 'Pracujete od 08:30' : 'Připraveni začít práci?'}</p>
            </div>
            <Button 
              size="lg" 
              className={`w-full h-16 text-xl font-bold transition-all shadow-lg ${activeShift ? 'bg-destructive hover:bg-destructive/90 text-white' : 'bg-primary hover:bg-primary/90 text-white'}`}
              onClick={() => setActiveShift(!activeShift)}
            >
              {activeShift ? (
                <> <Square className="w-5 h-5 mr-3 fill-white" /> Ukončit směnu </>
              ) : (
                <> <Play className="w-5 h-5 mr-3 fill-white" /> Začít pracovat </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 bg-surface border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Poslední záznamy</CardTitle>
              <CardDescription>Historie vaší docházky v {companyId}</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="gap-2">
              <CalendarIcon className="w-4 h-4" /> Export historie
            </Button>
          </CardHeader>
          <CardContent>
            {isHistoryLoading ? (
              <div className="flex justify-center p-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : historyData && historyData.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead>Datum</TableHead>
                    <TableHead>Příchod</TableHead>
                    <TableHead>Odchod</TableHead>
                    <TableHead>Celkem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyData.slice(0, 10).map((row, i) => (
                    <TableRow key={i} className="border-border hover:bg-muted/30">
                      <TableCell className="font-medium">{new Date(row.checkInTime).toLocaleDateString('cs-CZ')}</TableCell>
                      <TableCell>{new Date(row.checkInTime).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}</TableCell>
                      <TableCell>{row.checkOutTime ? new Date(row.checkOutTime).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '-'}</TableCell>
                      <TableCell>8h 15m</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-16 text-muted-foreground">
                Zatím nemáte žádné uložené záznamy docházky.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {isAdmin && (
        <Card className="bg-surface border-border">
          <CardHeader>
            <CardTitle>Stav týmu v reálném čase</CardTitle>
            <CardDescription>Členové organizace aktuálně na směně</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { name: 'Alex Rivera', role: 'Vývojář', status: 'active' },
                { name: 'Sára Millerová', role: 'UI Designer', status: 'active' },
                { name: 'Tomáš Novák', role: 'Manažer', status: 'offline' },
                { name: 'Jan Černý', role: 'Účetní', status: 'active' },
              ].map((emp, i) => (
                <div key={i} className="p-4 border border-border rounded-lg bg-background/40 flex items-center gap-4 hover:border-primary/50 transition-colors">
                  <div className={`w-3 h-3 rounded-full ${emp.status === 'active' ? 'bg-emerald-500 shadow-lg shadow-emerald-500/40 animate-pulse' : 'bg-muted'}`} />
                  <div>
                    <p className="font-semibold text-sm">{emp.name}</p>
                    <p className="text-xs text-muted-foreground">{emp.role}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
