
"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { 
  Play, 
  Square, 
  Clock, 
  Calendar as CalendarIcon, 
  Loader2, 
  Coffee, 
  UserCheck,
  History,
  Timer
} from 'lucide-react';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, serverTimestamp, query, orderBy, limit } from 'firebase/firestore';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type AttendanceType = 'check_in' | 'break_start' | 'break_end' | 'check_out';

export default function AttendancePage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [currentTime, setCurrentTime] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<AttendanceType | null>(null);

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
    return query(
      collection(firestore, 'companies', companyId, 'attendance'),
      orderBy('timestamp', 'desc'),
      limit(50)
    );
  }, [firestore, companyId]);

  const { data: historyData, isLoading: isHistoryLoading } = useCollection(attendanceQuery);

  // Zjištění aktuálního stavu z historie
  useEffect(() => {
    if (historyData && user) {
      const myLastAction = historyData.find(a => a.employeeId === user.uid);
      if (myLastAction) {
        setLastAction(myLastAction.type as AttendanceType);
      }
    }
  }, [historyData, user]);

  const handleAttendanceAction = (type: AttendanceType) => {
    if (!user || !companyId) return;

    const colRef = collection(firestore, 'companies', companyId, 'attendance');
    addDocumentNonBlocking(colRef, {
      employeeId: user.uid,
      employeeName: profile?.displayName || user.email,
      type,
      timestamp: serverTimestamp(),
      date: new Date().toISOString().split('T')[0]
    });

    const messages = {
      check_in: 'Příchod zaznamenán. Hezký pracovní den!',
      break_start: 'Pauza zahájena. Odpočiňte si.',
      break_end: 'Pauza ukončena. Zpět do práce.',
      check_out: 'Odchod zaznamenán. Hezký zbytek dne!'
    };

    toast({
      title: "Docházka aktualizována",
      description: messages[type]
    });
  };

  const isAdmin = profile?.role === 'owner' || profile?.role === 'admin' || profile?.globalRoles?.includes('super_admin');

  const getStatusBadge = (type: string) => {
    switch(type) {
      case 'check_in': return <Badge className="bg-emerald-500">Příchod</Badge>;
      case 'break_start': return <Badge variant="secondary" className="bg-amber-500 text-white">Pauza (začátek)</Badge>;
      case 'break_end': return <Badge variant="secondary" className="bg-blue-500 text-white">Pauza (konec)</Badge>;
      case 'check_out': return <Badge variant="destructive">Odchod</Badge>;
      default: return <Badge variant="outline">{type}</Badge>;
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Docházkový systém</h1>
          <p className="text-muted-foreground mt-2">Pracovní prostor: <span className="text-primary font-semibold">{companyId}</span></p>
        </div>
        <div className="bg-surface p-4 rounded-xl border border-primary/20 shadow-lg text-right min-w-[200px]">
          <p className="text-4xl font-mono font-bold text-primary">{currentTime || '--:--:--'}</p>
          <p className="text-sm text-muted-foreground font-medium">{new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
      </div>

      <Tabs defaultValue="terminal" className="w-full">
        <TabsList className="bg-surface border border-border mb-6">
          <TabsTrigger value="terminal" className="gap-2"><Timer className="w-4 h-4" /> Terminál</TabsTrigger>
          <TabsTrigger value="history" className="gap-2"><History className="w-4 h-4" /> Moje historie</TabsTrigger>
          {isAdmin && <TabsTrigger value="admin" className="gap-2"><UserCheck className="w-4 h-4" /> Přehled týmu</TabsTrigger>}
        </TabsList>

        <TabsContent value="terminal">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <Card className="lg:col-span-2 bg-surface border-border shadow-xl">
              <CardHeader>
                <CardTitle>Docházkový terminál</CardTitle>
                <CardDescription>Zaznamenejte svůj příchod, pauzu nebo odchod kliknutím na příslušné tlačítko.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-6">
                <Button 
                  size="lg" 
                  disabled={lastAction === 'check_in' || lastAction === 'break_end'}
                  className="h-24 text-xl font-bold bg-emerald-600 hover:bg-emerald-700 transition-all gap-3"
                  onClick={() => handleAttendanceAction('check_in')}
                >
                  <Play className="w-6 h-6 fill-white" /> Přihlásit příchod
                </Button>

                <Button 
                  size="lg" 
                  variant="outline"
                  disabled={lastAction !== 'check_in' && lastAction !== 'break_end'}
                  className="h-24 text-xl font-bold border-amber-500 text-amber-500 hover:bg-amber-500/10 transition-all gap-3"
                  onClick={() => handleAttendanceAction('break_start')}
                >
                  <Coffee className="w-6 h-6" /> Zahájit pauzu
                </Button>

                <Button 
                  size="lg" 
                  variant="outline"
                  disabled={lastAction !== 'break_start'}
                  className="h-24 text-xl font-bold border-blue-500 text-blue-500 hover:bg-blue-500/10 transition-all gap-3"
                  onClick={() => handleAttendanceAction('break_end')}
                >
                  <Clock className="w-6 h-6" /> Ukončit pauzu
                </Button>

                <Button 
                  size="lg" 
                  variant="destructive"
                  disabled={lastAction === 'check_out' || !lastAction || lastAction === 'break_start'}
                  className="h-24 text-xl font-bold transition-all gap-3"
                  onClick={() => handleAttendanceAction('check_out')}
                >
                  <Square className="w-6 h-6 fill-white" /> Odhlásit odchod
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-surface border-border shadow-xl">
              <CardHeader>
                <CardTitle>Aktuální stav</CardTitle>
                <CardDescription>Váš poslední záznam v systému</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center py-10 space-y-6">
                <div className={`w-32 h-32 rounded-full border-4 flex items-center justify-center transition-all ${lastAction === 'check_in' || lastAction === 'break_end' ? 'border-emerald-500 shadow-2xl shadow-emerald-500/20 animate-pulse' : 'border-muted'}`}>
                  <Clock className={`w-12 h-12 ${lastAction === 'check_in' || lastAction === 'break_end' ? 'text-emerald-500' : 'text-muted'}`} />
                </div>
                <div className="text-center">
                  <h3 className="text-2xl font-bold capitalize">
                    {lastAction === 'check_in' ? 'Pracujete' : 
                     lastAction === 'break_start' ? 'Na pauze' : 
                     lastAction === 'break_end' ? 'Pracujete' : 
                     lastAction === 'check_out' ? 'Mimo službu' : 'Nezahájeno'}
                  </h3>
                  <p className="text-muted-foreground mt-1">
                    Poslední akce: {lastAction ? getStatusBadge(lastAction) : 'Žádná'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history">
          <Card className="bg-surface border-border">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Moje historie docházky</CardTitle>
                <CardDescription>Záznamy vašich příchodů a odchodů</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {isHistoryLoading ? (
                <div className="flex justify-center p-12">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : historyData && historyData.filter(a => a.employeeId === user?.uid).length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border">
                      <TableHead>Datum</TableHead>
                      <TableHead>Čas</TableHead>
                      <TableHead>Typ akce</TableHead>
                      <TableHead className="text-right">Poznámka</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyData
                      .filter(a => a.employeeId === user?.uid)
                      .slice(0, 20)
                      .map((row, i) => (
                      <TableRow key={i} className="border-border hover:bg-muted/30">
                        <TableCell className="font-medium">
                          {row.timestamp?.toDate ? row.timestamp.toDate().toLocaleDateString('cs-CZ') : 'Dnes'}
                        </TableCell>
                        <TableCell>
                          {row.timestamp?.toDate ? row.timestamp.toDate().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                        </TableCell>
                        <TableCell>{getStatusBadge(row.type)}</TableCell>
                        <TableCell className="text-right text-muted-foreground text-xs italic">-</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-16 text-muted-foreground">
                  Zatím nemáte žádné záznamy docházky.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="admin">
            <Card className="bg-surface border-border">
              <CardHeader>
                <CardTitle>Celkový přehled týmu</CardTitle>
                <CardDescription>Poslední aktivity všech zaměstnanců organizace {companyId}</CardDescription>
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
                        <TableHead>Zaměstnanec</TableHead>
                        <TableHead>Datum</TableHead>
                        <TableHead>Čas</TableHead>
                        <TableHead>Akce</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyData.slice(0, 30).map((row, i) => (
                        <TableRow key={i} className="border-border hover:bg-muted/30">
                          <TableCell className="font-semibold">{row.employeeName || row.employeeId}</TableCell>
                          <TableCell>
                            {row.timestamp?.toDate ? row.timestamp.toDate().toLocaleDateString('cs-CZ') : 'Dnes'}
                          </TableCell>
                          <TableCell>
                            {row.timestamp?.toDate ? row.timestamp.toDate().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                          </TableCell>
                          <TableCell>{getStatusBadge(row.type)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-16 text-muted-foreground">
                    Žádná data o docházce týmu nebyla nalezena.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
