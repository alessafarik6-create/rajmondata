
"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/mock-auth';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, ShieldAlert } from 'lucide-react';
import Image from 'next/image';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');

  const handleLogin = (role: any) => {
    login(email || 'demo@bizforge.com', role);
    router.push(role === 'super_admin' ? '/admin/dashboard' : '/portal/dashboard');
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:block relative bg-black">
        <Image 
          src="https://picsum.photos/seed/bizforge-login/1200/1200"
          alt="Login background"
          fill
          className="object-cover opacity-50"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
        <div className="absolute bottom-12 left-12 right-12">
          <h1 className="text-4xl font-bold text-white mb-4">Empowering Enterprises with BizForge.</h1>
          <p className="text-xl text-muted-foreground">The all-in-one platform for multi-tenant business management and operational excellence.</p>
        </div>
      </div>

      <div className="flex items-center justify-center p-8 bg-background">
        <Card className="w-full max-w-md bg-surface border-border shadow-2xl">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
              <Building2 className="text-white w-7 h-7" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-3xl font-bold tracking-tight">Welcome Back</CardTitle>
              <CardDescription>Enter your credentials to access your portal</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="name@company.com" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" className="bg-background border-border" />
            </div>
            <Button className="w-full h-11 text-lg font-semibold" onClick={() => handleLogin('company_owner')}>
              Sign In
            </Button>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <div className="relative w-full">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-surface px-2 text-muted-foreground">Demo Accounts</span></div>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full">
              <Button variant="outline" size="sm" onClick={() => handleLogin('super_admin')}>
                <ShieldAlert className="w-4 h-4 mr-2" /> Admin Login
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleLogin('employee')}>
                <UserCircle className="w-4 h-4 mr-2" /> Employee Login
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

import { UserCircle } from 'lucide-react';
