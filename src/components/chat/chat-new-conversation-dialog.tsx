"use client";

import React, { useMemo, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ChatEmployeeOption = {
  employeeId: string | null;
  authUserId: string;
  label: string;
  roleLabel?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employees: ChatEmployeeOption[];
  canCreateGroup: boolean;
  onCreateDm: (authUserId: string, label: string) => void;
  onCreateGroup: (name: string, memberAuthUserIds: string[]) => void | Promise<void>;
  creating?: boolean;
};

export function ChatNewConversationDialog({
  open,
  onOpenChange,
  employees,
  canCreateGroup,
  onCreateDm,
  onCreateGroup,
  creating,
}: Props) {
  const [tab, setTab] = useState<"dm" | "group">("dm");
  const [dmUid, setDmUid] = useState("");
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sorted = useMemo(
    () => [...employees].sort((a, b) => a.label.localeCompare(b.label, "cs")),
    [employees]
  );

  const toggleMember = (uid: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nový chat</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as "dm" | "group")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="dm">Soukromý chat</TabsTrigger>
            <TabsTrigger value="group" disabled={!canCreateGroup}>
              Skupinový chat
            </TabsTrigger>
          </TabsList>
          <TabsContent value="dm" className="space-y-3 mt-3">
            <p className="text-xs text-muted-foreground">Vyberte kontakt ve firmě.</p>
            <ul className="max-h-64 overflow-y-auto space-y-1 border rounded-md p-1">
              {sorted.map((e) => (
                <li key={e.authUserId}>
                  <button
                    type="button"
                    className={`w-full text-left rounded px-2 py-2 text-sm hover:bg-muted/60 ${
                      dmUid === e.authUserId ? "bg-muted font-medium" : ""
                    }`}
                    onClick={() => setDmUid(e.authUserId)}
                  >
                    <span className="block font-medium">{e.label}</span>
                    {e.roleLabel ? (
                      <span className="block text-[11px] text-muted-foreground">{e.roleLabel}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button
                type="button"
                disabled={!dmUid || creating}
                onClick={() => {
                  const emp = sorted.find((x) => x.authUserId === dmUid);
                  if (!emp) return;
                  onCreateDm(emp.authUserId, emp.label);
                  onOpenChange(false);
                }}
              >
                Otevřít chat
              </Button>
            </DialogFooter>
          </TabsContent>
          <TabsContent value="group" className="space-y-3 mt-3">
            <div className="space-y-2">
              <Label htmlFor="group-name">Název skupiny</Label>
              <Input
                id="group-name"
                placeholder="Montážní tým Praha"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">Členové skupiny</p>
            <ul className="max-h-52 overflow-y-auto space-y-2 border rounded-md p-2">
              {sorted.map((e) => (
                <li key={e.authUserId} className="flex items-center gap-2">
                  <Checkbox
                    id={`m-${e.authUserId}`}
                    checked={selected.has(e.authUserId)}
                    onCheckedChange={() => toggleMember(e.authUserId)}
                  />
                  <label htmlFor={`m-${e.authUserId}`} className="text-sm cursor-pointer flex-1">
                    <span className="block">{e.label}</span>
                    {e.roleLabel ? (
                      <span className="block text-[11px] text-muted-foreground">{e.roleLabel}</span>
                    ) : null}
                  </label>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button
                type="button"
                disabled={creating || !groupName.trim() || selected.size === 0}
                onClick={() => void onCreateGroup(groupName.trim(), [...selected])}
              >
                Vytvořit skupinu
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
