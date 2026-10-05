"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { MeetingAiSuggestedTask } from "@/lib/meeting-records-media-types";

type Employee = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: MeetingAiSuggestedTask | null;
  employees: Employee[];
  onConfirm: (payload: {
    title: string;
    employeeId: string;
    dueDate: string;
  }) => Promise<void>;
};

export function MeetingAiTaskConfirmDialog({
  open,
  onOpenChange,
  task,
  employees,
  onConfirm,
}: Props) {
  const [title, setTitle] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDueDate(task.dueDate ?? "");
    const match = employees.find((e) =>
      task.assignedTo ? e.name.toLowerCase().includes(String(task.assignedTo).toLowerCase()) : false
    );
    setEmployeeId(match?.id ?? "");
  }, [task, employees]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vytvořit úkol</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Úkol</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Přiřadit</Label>
            <Select value={employeeId || "__none__"} onValueChange={(v) => setEmployeeId(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Vyberte zaměstnance" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Termín (YYYY-MM-DD)</Label>
            <Input value={dueDate} onChange={(e) => setDueDate(e.target.value)} placeholder="2026-10-08" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button
            disabled={busy || !title.trim()}
            onClick={() => {
              setBusy(true);
              void onConfirm({ title: title.trim(), employeeId, dueDate: dueDate.trim() }).finally(() =>
                setBusy(false)
              );
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Vytvořit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
