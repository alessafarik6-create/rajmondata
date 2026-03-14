"use client";

import React, { useState } from 'react';
import { useAuth } from '@/firebase';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, Loader2, UserPlus } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useToast } from '@/hooks/use-toast';

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({
        variant: "destructive",
        title: "Chybějící údaje",
        description: "Prosím zadejte email i heslo."
      });
      return;
    }

    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      
      toast({
        title: "Přihlášení úspěšné",
        description: "Vítejte zpět v BizForge."
      });

      router.push('/portal/dashboard');
    } catch (error: any) {
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
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:block relative bg-black">
        <Image 
          src="https://picsum.photos/seed/bizforge-login/1200/1200"
          alt="Login pozadí"
          fill
          className="object-cover opacity-50"
          data-ai-hint="dark abstract orange"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
        <div className="absolute bottom-12 left-12 right-12">
          <h1 className="text-4xl font-bold text-white mb-4">Posílení podnikání s BizForge.</h1>
          <p className="text-xl text-muted-foreground">Komplexní platforma pro správu firem a provozní dokonalost v multi-tenant prostředí.</p>
        </div>
      </div>

      <div className="flex items-center justify-center p-8 bg-background text-foreground">
        <Card className="w-full max-w-md bg-surface border-border shadow-2xl">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
              <Building2 className="text-white w-7 h-7" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-3xl font-bold tracking-tight text-foreground">Vítejte zpět</CardTitle>
              <CardDescription className="text-muted-foreground">Zadejte své údaje pro přístup k portálu</CardDescription>
            </div>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Emailová adresa</Label>
                <Input 
                  id="email" 
                  type="email" 
                  placeholder="jmeno@firma.cz" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-background border-border text-foreground"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Heslo</Label>
                <Input 
                  id="password" 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-background border-border text-foreground" 
                  required
                />
              </div>
              <Button type="submit" className="w-full h-11 text-lg font-semibold bg-primary hover:bg-primary/90 text-white" disabled={loading}>
                {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                Přihlásit se
              </Button>
            </CardContent>
          </form>
          <CardFooter className="flex flex-col gap-4">
            <div className="relative w-full">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">Nová firma?</span></div>
            </div>
            <Link href="/register" className="w-full">
              <Button variant="outline" className="w-full h-11 border-primary text-primary hover:bg-primary hover:text-white transition-all gap-2">
                <UserPlus className="w-4 h-4" /> Registrovat firmu
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}