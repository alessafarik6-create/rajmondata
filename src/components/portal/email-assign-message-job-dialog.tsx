"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useEmailJobSearch } from "@/hooks/use-email-job-search";
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  getToken: () => Promise<string>;
  busy?: boolean;
  onConfirm: (jobId: string) => Promise<void>;
};

export function EmailAssignMessageJobDialog(props: Props) {
  const [jobQuery, setJobQuery] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");

  const { jobs, loading, error } = useEmailJobSearch({
    companyId: props.companyId,
    enabled: props.open,
    query: jobQuery,
    getToken: props.getToken,
  });

  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        props.onOpenChange(o);
        if (!o) {
          setJobQuery("");
          setSelectedJobId("");
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Přiřadit e-mail k zakázce</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Hledat zakázku (číslo, zákazník, adresa…)"
            value={jobQuery}
            onChange={(e) => setJobQuery(e.target.value)}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Načítám zakázky…
            </div>
          ) : null}
          <Select value={selectedJobId} onValueChange={setSelectedJobId}>
            <SelectTrigger>
              <SelectValue placeholder="Vyberte zakázku" />
            </SelectTrigger>
            <SelectContent>
              {jobs.map((j) => (
                <SelectItem key={j.id} value={j.id}>
                  {j.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Zrušit
          </Button>
          <Button
            disabled={!selectedJobId || props.busy}
            onClick={() => void props.onConfirm(selectedJobId)}
          >
            Uložit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
