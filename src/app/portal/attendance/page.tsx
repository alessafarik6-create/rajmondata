
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Play, Square, Clock, Calendar as CalendarIcon } from 'lucide-react';
import { useAuth } from '@/lib/mock-auth';

export default function AttendancePage() {
  const { user } = useAuth();
  const [activeShift, setActiveShift] = useState(false);
  
  const history = [
    { date: '2024-05-20', in: '09:02 AM', out: '05:30 PM', total: '8h 28m', status: 'Present' },
    { date: '2024-05-19', in: '08:55 AM', out: '06:15 PM', total: '9h 20m', status: 'Overtime' },
    { date: '2024-05-18', in: '09:15 AM', out: '05:00 PM', total: '7h 45m', status: 'Under-time' },
    { date: '2024-05-17', in: '-', out: '-', total: '-', status: 'Absent' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Attendance & Time Tracking</h1>
          <p className="text-muted-foreground mt-2">Manage your daily work hours and shifts.</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-mono font-bold">10:45 AM</p>
          <p className="text-sm text-muted-foreground">Tuesday, May 21 2024</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="bg-surface border-border flex flex-col justify-between">
          <CardHeader>
            <CardTitle>Current Status</CardTitle>
            <CardDescription>Start or end your daily shift</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col items-center justify-center py-8">
            <div className={`w-32 h-32 rounded-full border-4 flex items-center justify-center mb-6 ${activeShift ? 'border-primary animate-pulse' : 'border-muted'}`}>
              <Clock className={`w-12 h-12 ${activeShift ? 'text-primary' : 'text-muted'}`} />
            </div>
            <div className="text-center mb-8">
              <h3 className="text-xl font-bold">{activeShift ? 'You are Clocked In' : 'You are Clocked Out'}</h3>
              <p className="text-muted-foreground">{activeShift ? 'Shift started at 09:12 AM' : 'Ready to start your day?'}</p>
            </div>
            <Button 
              size="lg" 
              className={`w-full h-14 text-lg font-bold transition-all ${activeShift ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary hover:bg-primary/90'}`}
              onClick={() => setActiveShift(!activeShift)}
            >
              {activeShift ? (
                <> <Square className="w-5 h-5 mr-2 fill-white" /> Clock Out </>
              ) : (
                <> <Play className="w-5 h-5 mr-2 fill-white" /> Clock In Now </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 bg-surface border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent History</CardTitle>
              <CardDescription>Your logs for the last 7 days</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="gap-2">
              <CalendarIcon className="w-4 h-4" /> Custom Range
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead>Date</TableHead>
                  <TableHead>Check In</TableHead>
                  <TableHead>Check Out</TableHead>
                  <TableHead>Total Hours</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((row, i) => (
                  <TableRow key={i} className="border-border">
                    <TableCell className="font-medium">{row.date}</TableCell>
                    <TableCell>{row.in}</TableCell>
                    <TableCell>{row.out}</TableCell>
                    <TableCell>{row.total}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'Overtime' ? 'default' : row.status === 'Absent' ? 'destructive' : 'secondary'}>
                        {row.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {user?.role !== 'employee' && (
        <Card className="bg-surface border-border">
          <CardHeader>
            <CardTitle>Team Attendance Overview</CardTitle>
            <CardDescription>Real-time view of your team members currently on shift</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { name: 'Alex Thompson', role: 'Lead Dev', status: 'active' },
                { name: 'Sarah Miller', role: 'Designer', status: 'active' },
                { name: 'John Doe', role: 'Manager', status: 'offline' },
                { name: 'Emily Chen', role: 'Accountant', status: 'active' },
              ].map((emp, i) => (
                <div key={i} className="p-4 border border-border rounded-lg bg-background/40 flex items-center gap-4">
                  <div className={`w-3 h-3 rounded-full ${emp.status === 'active' ? 'bg-emerald-500 shadow-lg shadow-emerald-500/20' : 'bg-muted'}`} />
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
