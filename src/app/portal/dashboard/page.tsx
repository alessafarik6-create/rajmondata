
"use client";

import React from 'react';
import { 
  Users, 
  Briefcase, 
  Clock, 
  Wallet,
  Sparkles,
  CheckCircle2,
  Calendar
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

export default function CompanyDashboard() {
  const activeJobs = [
    { id: '1', title: 'Website Overhaul', client: 'Acme Corp', progress: 75, status: 'on_track' },
    { id: '2', title: 'Marketing Campaign', client: 'Global X', progress: 40, status: 'delayed' },
    { id: '3', title: 'Server Migration', client: 'Internal', progress: 95, status: 'on_track' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold">Good morning, Nebula Tech</h1>
          <p className="text-muted-foreground mt-2">Here's your organization's performance for today.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="gap-2">
            <Calendar className="w-4 h-4" /> Schedule
          </Button>
          <Button className="gap-2">
            <Briefcase className="w-4 h-4" /> New Job
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="bg-surface border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Employees</CardTitle>
            <Users className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">42 / 45</div>
            <p className="text-xs text-muted-foreground mt-1">3 on leave today</p>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Jobs</CardTitle>
            <Briefcase className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">12</div>
            <p className="text-xs text-muted-foreground mt-1">4 nearing deadline</p>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Today's Attendance</CardTitle>
            <Clock className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">94%</div>
            <p className="text-xs text-muted-foreground mt-1">2 late arrivals</p>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Monthly Rev</CardTitle>
            <Wallet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$12,450</div>
            <p className="text-xs text-emerald-500 mt-1">+15% from last month</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle>Ongoing Projects</CardTitle>
              <CardDescription>Performance of your most important active jobs</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {activeJobs.map((job) => (
                <div key={job.id} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <h4 className="font-semibold">{job.title}</h4>
                      <p className="text-xs text-muted-foreground">{job.client}</p>
                    </div>
                    <Badge variant={job.status === 'on_track' ? 'default' : 'destructive'} className="capitalize">
                      {job.status.replace('_', ' ')}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4">
                    <Progress value={job.progress} className="flex-1" />
                    <span className="text-sm font-medium">{job.progress}%</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="bg-primary/5 border-primary/20 relative overflow-hidden">
             <div className="absolute top-0 right-0 p-8 opacity-10">
               <Sparkles className="w-24 h-24 text-primary" />
             </div>
             <CardHeader>
               <CardTitle className="flex items-center gap-2 text-primary">
                 <Sparkles className="w-5 h-5" /> AI Performance Insight
               </CardTitle>
             </CardHeader>
             <CardContent>
               <p className="text-lg leading-relaxed">
                 Nebula Tech is showing <span className="font-bold text-white">exceptional growth</span> in attendance consistency this month. 
                 However, "Marketing Campaign" is falling behind. Recommendation: Reassign 2 available employees from completed 
                 tasks to expedite the campaign phase.
               </p>
               <Button className="mt-6 bg-primary hover:bg-secondary">View Full AI Report</Button>
             </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Button variant="outline" className="justify-start w-full">Employee Check-in Log</Button>
              <Button variant="outline" className="justify-start w-full">Generate Invoice</Button>
              <Button variant="outline" className="justify-start w-full">Approve Time-off</Button>
              <Button variant="outline" className="justify-start w-full">Upload Documents</Button>
            </CardContent>
          </Card>

          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { user: 'Sarah J.', action: 'Checked in', time: '5m ago' },
                { user: 'Mike T.', action: 'Completed Job #23', time: '1h ago' },
                { user: 'Accountant', action: 'Uploaded Tax Doc', time: '3h ago' },
                { user: 'System', action: 'Plan Renewed', time: '1d ago' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <div className="mt-0.5 w-2 h-2 rounded-full bg-primary" />
                  <div>
                    <span className="font-semibold">{item.user}</span> {item.action}
                    <p className="text-xs text-muted-foreground mt-0.5">{item.time}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
