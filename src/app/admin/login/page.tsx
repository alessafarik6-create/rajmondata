
"use client";

import React, { useState } from 'react';
import { useAuth } from '@/firebase';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldCheck, Loader2, Lock, Info } from 'lucide-react';
import { signInWithEmailAndPassword, getIdTokenResult, signOut } from 'firebase/auth';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function AdminLoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 1. Přihlášení uživatele
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      // 2. Načtení custom claims
      const tokenResult = await getIdTokenResult(user, true);
      const systemRole = tokenResult.claims.systemRole;

      // 3. Ověření role (v prototypu povolujeme admin@bizforge.cz i bez claimu pro testování)
      if (systemRole === 'super_admin' || user.email === 'admin@bizforge.cz') {
        toast({
          title: "Přihlášení úspěšné",
          description: "Vítejte v globální administraci."
        });
        router.push('/admin/dashboard');
      } else {
        await signOut(auth);
        toast({
          variant: "destructive",
          title: "Přístup odepřen",
          description: "Nemáte oprávnění pro globální administraci."
        });
      }
    } catch (error: any) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Chyba přihlášení",
        description: "Neplatný email nebo heslo."
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black p-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-md space-y-6 relative z-10">
        <Card className="bg-zinc-900 border-zinc-800 shadow-2xl border-t-primary/20">
          <CardHeader className="text-center space-y-4 pt-8">
            <div className="mx-auto w-16 h-16 bg-primary rounded-2xl flex items-center justify-center shadow-2xl shadow-primary/20">
              <ShieldCheck className="text-white w-10 h-10" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-3xl font-bold tracking-tight text-white">Globální administrace</CardTitle>
              <CardDescription className="text-zinc-400">Přihlaste se do systémové administrace</CardDescription>
            </div>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4 pb-8">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-zinc-300">Emailová adresa</Label>
                <Input 
                  id="email" 
                  type="email" 
                  placeholder="admin@bizforge.cz" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-zinc-950 border-zinc-800 text-white focus:ring-primary h-11"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" title="Heslo" className="text-zinc-300">Heslo</Label>
                <Input 
                  id="password" 
                  type="password" 
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-zinc-950 border-zinc-800 text-white focus:ring-primary h-11" 
                  required
                />
              </div>
              <Button 
                type="submit" 
                className="w-full h-12 text-lg font-bold bg-primary hover:bg-primary/90 text-white shadow-lg mt-2" 
                disabled={loading}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
                Přihlásit do administrace
              </Button>
            </CardContent>
          </form>
        </Card>

        <Alert className="bg-zinc-900/50 border-zinc-800 text-zinc-400">
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <p className="font-bold text-zinc-300 mb-1">Demo údaje pro Super Admina:</p>
            <p>Email: <span className="text-primary select-all">admin@bizforge.cz</span></p>
            <p>Heslo: <span className="text-primary select-all">admin123</span></p>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
