
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Plus, Search, Filter, Sparkles, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { generateEmployeePerformanceReport } from '@/ai/flows/generate-employee-performance-report-flow';

export default function EmployeesPage() {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);

  const employees = [
    { id: '1', name: 'Alex Thompson', role: 'Lead Developer', status: 'active', email: 'alex@nebula.tech', joined: 'Jan 2022' },
    { id: '2', name: 'Sarah Miller', role: 'Product Designer', status: 'active', email: 'sarah@nebula.tech', joined: 'Mar 2023' },
    { id: '3', name: 'Mike Ross', role: 'Manager', status: 'active', email: 'mike@nebula.tech', joined: 'Feb 2021' },
    { id: '4', name: 'Emily Chen', role: 'Accountant', status: 'on_leave', email: 'emily@nebula.tech', joined: 'Jun 2023' },
    { id: '5', name: 'David Lee', role: 'DevOps Engineer', status: 'active', email: 'david@nebula.tech', joined: 'Nov 2022' },
  ];

  const handleAiReport = async () => {
    setIsGenerating(true);
    try {
      // Simulate real report generation using the provided genkit flow
      const report = await generateEmployeePerformanceReport({
        employeeNames: ['Alex Thompson'],
        reportContext: "Alex has 98% attendance, completed 24 tickets this sprint, and received 5 peer praises.",
        reportPurpose: "Annual performance review",
        reportType: "individual"
      });
      
      toast({
        title: "AI Report Generated",
        description: `Strength: ${report.strengths[0]}`,
      });
    } catch (e) {
      toast({
        title: "Generation Failed",
        variant: "destructive",
        description: "Could not generate report at this time.",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold">Employee Directory</h1>
          <p className="text-muted-foreground mt-2">Manage your workforce, roles, and performance insights.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="gap-2" onClick={handleAiReport} disabled={isGenerating}>
            <Sparkles className={`w-4 h-4 text-primary ${isGenerating ? 'animate-spin' : ''}`} /> 
            {isGenerating ? 'Analyzing...' : 'AI Performance Report'}
          </Button>
          <Button className="gap-2">
            <Plus className="w-4 h-4" /> Add Employee
          </Button>
        </div>
      </div>

      <Card className="bg-surface border-border overflow-hidden">
        <div className="p-4 border-b bg-background/30 flex flex-col sm:flex-row gap-4 justify-between">
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search employees..." className="pl-10 bg-background border-border" />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="w-4 h-4" /> Filter
            </Button>
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="w-4 h-4" /> Export
            </Button>
          </div>
        </div>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="pl-6">Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((emp) => (
                <TableRow key={emp.id} className="border-border hover:bg-muted/30">
                  <TableCell className="pl-6 font-medium">
                    <div className="flex flex-col">
                      <span>{emp.name}</span>
                      <span className="text-xs text-muted-foreground font-normal">{emp.email}</span>
                    </div>
                  </TableCell>
                  <TableCell>{emp.role}</TableCell>
                  <TableCell>{emp.joined}</TableCell>
                  <TableCell>
                    <Badge variant={emp.status === 'active' ? 'default' : 'secondary'} className="capitalize">
                      {emp.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    <Button variant="ghost" size="sm">Manage</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
