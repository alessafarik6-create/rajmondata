"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Play, 
  Square, 
  Clock, 
  Coffee, 
  User, 
  Timer, 
  ChevronRight,
  LogOut,
  Calendar as CalendarIcon,
  Loader2,
  Smartphone,
  Delete,
  X,
  Camera,
  AlertCircle,
  Inbox
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection, useAuth, useCompany } from '@/firebase';
import { doc, collection, serverTimestamp, query, orderBy, limit, where } from 'firebase/firestore';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useToast } from '@/hooks/use-toast';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';

type AttendanceType = 'check_in' | 'break_start' | 'break_end' | 'check_out';
type TerminalMode = 'personal' | 'pin' | 'qr';

export default function MobileTerminalPage() {
  const { user } = useUser();
  const auth = useAuth();
  const firestore = useFirestore();
  const { toast } = useToast();
  const router = useRouter();
  const { companyName } = useCompany();
  
  const [terminalMode, setTerminalMode] = useState<TerminalMode>('personal');
  const [pin, setPin] = useState('');
  const [activeEmployee, setActiveEmployee] = useState<any | null>(null);
  const [currentTime, setCurrentTime] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<AttendanceType | null>(null);
  const [todaySummary, setTodaySummary] = useState({ checkIn: '--:--', checkOut: '--:--', worked: '0h 0m' });
  const [isScanning, setIsScanning] = useState(false);
  const [isClient, setIsClient] = useState(false);
  
  const scannerRef = useRef<any>(null);

  useEffect(() => {
    setIsClient(true);
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setCurrentDate(now.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile, isLoading: profileLoading, error: profileError } = useDoc(userRef);
  const companyId = profile?.companyId;

  const personalAttendanceQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !user || terminalMode !== 'personal') return null;
    const today = new Date().toISOString().split('T')[0];
    return query(
      collection(firestore, 'companies', companyId, 'attendance'),
      where('employeeId', '==', user.uid),
      where('date', '==', today),
      orderBy('timestamp', 'desc')
    );
  }, [firestore, companyId, user, terminalMode]);

  const { data: todayAttendance, isLoading: attendanceLoading, error: attendanceError } = useCollection(personalAttendanceQuery);

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || terminalMode === 'personal') return null;
    return collection(firestore, 'companies', companyId, 'employees');
  }, [firestore, companyId, terminalMode]);
  const { data: employees, isLoading: employeesLoading, error: employeesError } = useCollection(employeesQuery);

  // Log Firestore errors for debugging
  useEffect(() => {
    if (profileError) {
      console.error('[AttendanceTerminal] Firestore profile error:', profileError.message, profileError);
    }
  }, [profileError]);
  useEffect(() => {
    if (attendanceError) {
      console.error('[AttendanceTerminal] Firestore attendance error:', attendanceError.message, attendanceError);
    }
  }, [attendanceError]);
  useEffect(() => {
    if (employeesError) {
      console.error('[AttendanceTerminal] Firestore employees error:', employeesError.message, employeesError);
    }
  }, [employeesError]);

  // Show toast when a write to attendance fails (permission or other Firestore error)
  useEffect(() => {
    const handler = (err: FirestorePermissionError) => {
      const path = err.request?.path ?? '';
      if (path.includes('attendance')) {
        console.error('[AttendanceTerminal] Firestore write error:', err.message, err);
        toast({ variant: 'destructive', title: 'Záznam se nepodařilo uložit. Zkontrolujte oprávnění.' });
      }
    };
    errorEmitter.on('permission-error', handler);
    return () => errorEmitter.off('permission-error', handler);
  }, [toast]);

  useEffect(() => {
    if (terminalMode === 'personal' && !attendanceError && todayAttendance && todayAttendance.length > 0) {
      updateAttendanceStatus(todayAttendance);
    }
  }, [todayAttendance, terminalMode, attendanceError]);

  const updateAttendanceStatus = (history: any[]) => {
    const latest = history[0];
    setLastAction(latest.type as AttendanceType);

    const checkInDoc = history.find(a => a.type === 'check_in');
    const checkOutDoc = history.find(a => a.type === 'check_out');

    const formatTime = (ts: any) => ts?.toDate ? ts.toDate().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '--:--';
    
    setTodaySummary({
      checkIn: formatTime(checkInDoc?.timestamp),
      checkOut: formatTime(checkOutDoc?.timestamp),
      worked: "7h 45m"
    });
  };

  const handlePinPress = (num: string) => {
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      if (newPin.length === 4) {
        lookupEmployeeByPin(newPin);
      }
    }
  };

  const handleClear = () => {
    setPin('');
    setActiveEmployee(null);
    setLastAction(null);
    stopScanner();
  };

  const lookupEmployeeByPin = (code: string) => {
    if (!employees) return;
    const emp = employees.find(e => e.attendancePin === code);
    if (emp) {
      setActiveEmployee(emp);
      toast({ title: `Vítejte, ${emp.firstName}!`, duration: 2000 });
    } else {
      setPin('');
      toast({ variant: "destructive", title: "Neplatný PIN", duration: 2000 });
    }
  };

  const lookupEmployeeByQr = (qrId: string) => {
    if (!employees) return;
    const emp = employees.find(e => e.attendanceQrId === qrId);
    if (emp) {
      setActiveEmployee(emp);
      toast({ title: `Nalezen zaměstnanec: ${emp.firstName}`, duration: 2000 });
      stopScanner();
    } else {
      toast({ variant: "destructive", title: "QR kód nebyl rozpoznán", duration: 2000 });
    }
  };

  const startScanner = async () => {
    if (!isClient) return;
    setIsScanning(true);
    try {
      // Dynamically import to avoid SSR crash
      const { Html5Qrcode } = await import('html5-qrcode');
      const html5QrCode = new Html5Qrcode("reader");
      scannerRef.current = html5QrCode;
      
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };
      
      await html5QrCode.start(
        { facingMode: "environment" }, 
        config, 
        (decodedText) => {
          lookupEmployeeByQr(decodedText);
        },
        () => {}
      );
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "Chyba při přístupu ke kameře" });
      setIsScanning(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        await scannerRef.current.clear();
      } catch (e) {}
    }
    setIsScanning(false);
  };

  const handleAction = (type: AttendanceType) => {
    const targetId = terminalMode !== 'personal' ? activeEmployee?.id : user?.uid;
    const targetName = terminalMode !== 'personal' ? `${activeEmployee?.firstName} ${activeEmployee?.lastName}` : (profile?.displayName || user?.email);

    if (!targetId || !companyId) return;

    const colRef = collection(firestore, 'companies', companyId, 'attendance');
    addDocumentNonBlocking(colRef, {
      employeeId: targetId,
      employeeName: targetName,
      type,
      timestamp: serverTimestamp(),
      date: new Date().toISOString().split('T')[0],
      terminalId: terminalMode === 'pin' ? 'shared-pin-terminal' : terminalMode === 'qr' ? 'qr-scanner-terminal' : 'mobile-personal'
    });

    const messages = {
      check_in: 'Příchod zaznamenán',
      break_start: 'Pauza zahájena',
      break_end: 'Pauza ukončena',
      check_out: 'Odchod zaznamenán'
    };

    toast({ title: messages[type], duration: 2000 });

    if (terminalMode !== 'personal') {
      setTimeout(handleClear, 1500);
    }
  };

  if (!user) return null;

  // —— Profile loading: show clock + loading state ——
  if (profileLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col p-4 md:p-8 max-w-md mx-auto min-w-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-start mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
              <Smartphone className="text-white w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-tight truncate">{companyName || 'BizForge Terminál'}</h1>
              <p className="text-xs text-muted-foreground uppercase font-bold tracking-tighter">Načítání…</p>
            </div>
          </div>
        </div>
        <Card className="border-primary/20 shadow-2xl mb-6 overflow-hidden relative">
          <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
          <CardContent className="pt-6 pb-4 text-center">
            <p className="text-5xl font-mono font-bold text-primary tracking-tighter mb-1">
              {currentTime || '00:00:00'}
            </p>
            <p className="text-sm text-muted-foreground font-medium flex items-center justify-center gap-2">
              <CalendarIcon className="w-3 h-3" /> {currentDate}
            </p>
          </CardContent>
        </Card>
        <div className="flex-1 flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-4 text-muted-foreground">
            <Loader2 className="w-10 h-10 animate-spin" />
            <p className="text-sm font-medium">Načítání profilu…</p>
          </div>
        </div>
        <Button variant="link" onClick={() => router.push('/portal/dashboard')} className="text-xs text-muted-foreground mt-4 w-fit">
          Zpět do portálu <ChevronRight className="w-3 h-3 ml-1 shrink-0" />
        </Button>
      </div>
    );
  }

  // —— Profile error: permission denied or Firestore error ——
  if (profileError) {
    return (
      <div className="min-h-screen bg-background flex flex-col p-4 md:p-8 max-w-md mx-auto min-w-0">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 shrink-0 bg-primary rounded-lg flex items-center justify-center">
            <Smartphone className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold truncate">{companyName || 'BizForge Terminál'}</h1>
        </div>
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Profil se nepodařilo načíst</AlertTitle>
          <AlertDescription>
            Nemáme přístup k vašim údajům (např. oprávnění Firestore). Zkuste se odhlásit a přihlásit znovu, nebo kontaktujte administrátora.
          </AlertDescription>
        </Alert>
        <div className="flex flex-col gap-3 mt-auto">
          <Button variant="outline" onClick={() => signOut(auth)} className="gap-2 min-h-[44px]">
            <LogOut className="w-4 h-4" /> Odhlásit se
          </Button>
          <Button variant="link" onClick={() => router.push('/portal/dashboard')} className="text-muted-foreground">
            Zpět do portálu <ChevronRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </div>
    );
  }

  // —— No profile document (empty) or no company ——
  if (!profile || !companyId) {
    return (
      <div className="min-h-screen bg-background flex flex-col p-4 md:p-8 max-w-md mx-auto min-w-0">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 shrink-0 bg-primary rounded-lg flex items-center justify-center">
            <Smartphone className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold truncate">{companyName || 'BizForge Terminál'}</h1>
        </div>
        <Alert className="mb-6">
          <Inbox className="h-4 w-4" />
          <AlertTitle>Profil nenalezen</AlertTitle>
          <AlertDescription>
            {!profile
              ? 'Váš uživatelský profil v systému chybí.'
              : 'Nemáte přiřazenou firmu. Kontaktujte administrátora.'}
          </AlertDescription>
        </Alert>
        <div className="flex flex-col gap-3 mt-auto">
          <Button variant="outline" onClick={() => signOut(auth)} className="gap-2 min-h-[44px]">
            <LogOut className="w-4 h-4" /> Odhlásit se
          </Button>
          <Button variant="link" onClick={() => router.push('/portal/dashboard')} className="text-muted-foreground">
            Zpět do portálu <ChevronRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col p-4 md:p-8 max-w-md mx-auto min-w-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-start mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 shrink-0 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
            <Smartphone className="text-white w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight truncate">{companyName || 'BizForge Terminál'}</h1>
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-tighter truncate">
              {companyName ? 'Docházkový terminál' : companyId}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-2">
          <div className="flex gap-1 p-1 rounded-lg border border-border bg-muted/30">
            <Button 
              variant={terminalMode === 'personal' ? 'default' : 'ghost'} 
              size="sm" 
              className="min-h-[44px] flex-1 sm:flex-initial sm:h-7 sm:min-h-0 px-2 text-[10px] sm:text-[10px]" 
              onClick={() => { setTerminalMode('personal'); handleClear(); }}
            >
              OSOBNÍ
            </Button>
            <Button 
              variant={terminalMode === 'pin' ? 'default' : 'ghost'} 
              size="sm" 
              className="min-h-[44px] flex-1 sm:flex-initial sm:h-7 sm:min-h-0 px-2 text-[10px]" 
              onClick={() => { setTerminalMode('pin'); handleClear(); }}
            >
              PIN
            </Button>
            <Button 
              variant={terminalMode === 'qr' ? 'default' : 'ghost'} 
              size="sm" 
              className="min-h-[44px] flex-1 sm:flex-initial sm:h-7 sm:min-h-0 px-2 text-[10px]" 
              onClick={() => { setTerminalMode('qr'); handleClear(); }}
            >
              QR
            </Button>
          </div>
          {terminalMode === 'personal' && (
            <Button variant="ghost" size="sm" onClick={() => signOut(auth)} className="min-h-[44px] sm:min-h-0 text-xs text-muted-foreground hover:text-destructive touch-manipulation">
              Odhlásit <LogOut className="w-3 h-3 ml-1 shrink-0" />
            </Button>
          )}
        </div>
      </div>

      <Card className="bg-surface border-primary/20 shadow-2xl mb-6 overflow-hidden relative">
        <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
        <CardContent className="pt-6 pb-4 text-center">
          <p className="text-5xl font-mono font-bold text-primary tracking-tighter mb-1">
            {currentTime || '00:00:00'}
          </p>
          <p className="text-sm text-muted-foreground font-medium flex items-center justify-center gap-2">
            <CalendarIcon className="w-3 h-3" /> {currentDate}
          </p>
        </CardContent>
      </Card>

      {terminalMode === 'personal' && attendanceError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Dnešní docházku nelze načíst</AlertTitle>
          <AlertDescription>
            Oprávnění k záznamům docházky jsou omezená. Příchod a odchod stále můžete zapisovat.
          </AlertDescription>
        </Alert>
      )}

      {terminalMode === 'pin' && !activeEmployee && (
        <div className="flex-1 flex flex-col items-center">
          {employeesError && (
            <Alert variant="destructive" className="mb-4 w-full max-w-[280px]">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Seznam zaměstnanců není k dispozici</AlertTitle>
              <AlertDescription>
                Načtení zaměstnanců selhalo (např. oprávnění Firestore). Zkuste režim Osobní nebo kontaktujte administrátora.
              </AlertDescription>
            </Alert>
          )}
          {employeesLoading && !employeesError && (
            <div className="flex items-center gap-2 text-muted-foreground mb-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Načítání zaměstnanců…</span>
            </div>
          )}
          <div className="w-full max-w-[280px] space-y-6">
            <div className="text-center">
              <h2 className="text-lg font-bold mb-1">Zadejte svůj PIN</h2>
              <div className="flex justify-center gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className={`w-4 h-4 rounded-full border-2 border-primary ${pin.length > i ? 'bg-primary' : 'bg-transparent'}`} />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'DEL'].map((val) => (
                <Button
                  key={val}
                  variant={val === 'C' || val === 'DEL' ? 'outline' : 'default'}
                  className={`h-16 text-xl font-bold rounded-xl ${val === 'DEL' ? 'text-rose-500 border-rose-500/20' : ''}`}
                  onClick={() => {
                    if (val === 'C') handleClear();
                    else if (val === 'DEL') setPin(pin.slice(0, -1));
                    else handlePinPress(val);
                  }}
                >
                  {val === 'DEL' ? <Delete className="w-6 h-6" /> : val}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      {terminalMode === 'qr' && !activeEmployee && (
        <div className="flex-1 flex flex-col items-center space-y-6">
          {employeesError && (
            <Alert variant="destructive" className="w-full max-w-[300px]">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Seznam zaměstnanců není k dispozici</AlertTitle>
              <AlertDescription>
                Načtení zaměstnanců selhalo (např. oprávnění Firestore). Zkuste režim Osobní nebo kontaktujte administrátora.
              </AlertDescription>
            </Alert>
          )}
          {employeesLoading && !employeesError && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Načítání zaměstnanců…</span>
            </div>
          )}
          <div className="text-center">
            <h2 className="text-lg font-bold">Naskenujte QR kód</h2>
            <p className="text-sm text-muted-foreground">Namířte kameru na svůj docházkový kód</p>
          </div>
          
          <div className="w-full aspect-square max-w-[300px] bg-black rounded-2xl overflow-hidden border-2 border-primary/50 relative shadow-2xl">
            <div id="reader" className="w-full h-full"></div>
            {!isScanning && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <Button onClick={startScanner} className="gap-2">
                  <Camera className="w-4 h-4" /> Spustit skener
                </Button>
              </div>
            )}
            {isScanning && (
              <div className="absolute top-0 left-0 w-full h-1 bg-primary animate-bounce" />
            )}
          </div>
          
          {isScanning && (
            <Button variant="ghost" onClick={stopScanner} className="text-muted-foreground">
              Zrušit skenování
            </Button>
          )}
        </div>
      )}

      {(terminalMode === 'personal' || activeEmployee) && (
        <>
          <div className="flex items-center gap-4 mb-6 p-4 rounded-2xl bg-surface/50 border border-border">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <User className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold truncate">
                {terminalMode !== 'personal' ? `${activeEmployee?.firstName} ${activeEmployee?.lastName}` : (profile?.displayName || user.email)}
              </p>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <p className="text-xs text-muted-foreground capitalize">
                  {terminalMode !== 'personal' ? activeEmployee?.jobTitle : (profile?.role || 'Zaměstnanec')}
                </p>
              </div>
            </div>
            {terminalMode !== 'personal' && (
              <Button variant="ghost" size="icon" onClick={handleClear} className="text-muted-foreground"><X className="w-4 h-4" /></Button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 mb-6">
            <Button 
              disabled={lastAction === 'check_in' || lastAction === 'break_end'}
              onClick={() => handleAction('check_in')}
              className="h-20 text-xl font-bold rounded-2xl shadow-lg bg-emerald-600 hover:bg-emerald-700 transition-all gap-4"
            >
              <Play className="w-6 h-6 fill-white" /> Přihlásit příchod
            </Button>

            <div className="grid grid-cols-2 gap-4">
              <Button 
                variant="outline"
                disabled={lastAction !== 'check_in' && lastAction !== 'break_end'}
                onClick={() => handleAction('break_start')}
                className="h-20 text-lg font-bold rounded-2xl border-amber-500/50 text-amber-500 hover:bg-amber-500/10 gap-2"
              >
                <Coffee className="w-5 h-5" /> Pauza
              </Button>
              <Button 
                variant="outline"
                disabled={lastAction !== 'break_start'}
                onClick={() => handleAction('break_end')}
                className="h-20 text-lg font-bold rounded-2xl border-blue-500/50 text-blue-500 hover:bg-blue-500/10 gap-2"
              >
                <Timer className="w-5 h-5" /> Konec pauzy
              </Button>
            </div>

            <Button 
              variant="destructive"
              disabled={lastAction === 'check_out' || !lastAction || lastAction === 'break_start'}
              onClick={() => handleAction('check_out')}
              className="h-20 text-xl font-bold rounded-2xl shadow-lg transition-all gap-4"
            >
              <Square className="w-6 h-6 fill-white" /> Odhlásit odchod
            </Button>
          </div>

          {terminalMode === 'personal' && (
            <Card className="bg-surface/30 border-border mt-auto">
              <CardHeader className="py-4">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Timer className="w-4 h-4 text-primary" /> Dnešní přehled
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-2 pb-6">
                <div className="text-center p-2 rounded-xl bg-background/50 border border-border">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Příchod</p>
                  <p className="text-sm font-bold text-emerald-500">{todaySummary.checkIn}</p>
                </div>
                <div className="text-center p-2 rounded-xl bg-background/50 border border-border">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Odchod</p>
                  <p className="text-sm font-bold text-rose-500">{todaySummary.checkOut}</p>
                </div>
                <div className="text-center p-2 rounded-xl bg-background/50 border border-border">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Odpracováno</p>
                  <p className="text-sm font-bold text-primary">{todaySummary.worked}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {terminalMode === 'personal' && (
        <Button variant="link" onClick={() => router.push('/portal/dashboard')} className="text-xs text-muted-foreground mt-4">
          Zpět do portálu <ChevronRight className="w-3 h-3 ml-1" />
        </Button>
      )}
    </div>
  );
}
