"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export type ProductionTaskFormValues = {
  name: string;
  description: string;
  nameUk: string;
  descriptionUk: string;
  activityType: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial: ProductionTaskFormValues;
  busy: boolean;
  getToken: () => Promise<string>;
  onSubmit: (values: ProductionTaskFormValues) => Promise<void>;
};

export function ProductionTaskFormDialog(props: Props) {
  const { toast } = useToast();
  const [values, setValues] = useState(props.initial);
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    if (props.open) setValues(props.initial);
  }, [props.open, props.initial]);

  const translateAi = async () => {
    if (!values.name.trim() && !values.description.trim()) return;
    setTranslating(true);
    try {
      const token = await props.getToken();
      const res = await fetch("/api/company/production/tasks/translate-ua", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: values.name,
          description: values.description,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Překlad selhal");
      setValues((v) => ({
        ...v,
        nameUk: data.nameUk ?? v.nameUk,
        descriptionUk: data.descriptionUk ?? v.descriptionUk,
      }));
      toast({ title: "Návrh překladu — zkontrolujte před uložením" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "AI překlad",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setTranslating(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Název (CS)</Label>
            <Input
              value={values.name}
              onChange={(e) => setValues({ ...values, name: e.target.value })}
            />
          </div>
          <div>
            <Label>Popis (CS)</Label>
            <Textarea
              rows={3}
              value={values.description}
              onChange={(e) => setValues({ ...values, description: e.target.value })}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={translating}
            onClick={() => void translateAi()}
          >
            {translating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Přeložit pomocí AI
          </Button>
          <div>
            <Label>Název (UA)</Label>
            <Input
              value={values.nameUk}
              onChange={(e) => setValues({ ...values, nameUk: e.target.value })}
            />
          </div>
          <div>
            <Label>Popis (UA)</Label>
            <Textarea
              rows={3}
              value={values.descriptionUk}
              onChange={(e) => setValues({ ...values, descriptionUk: e.target.value })}
            />
          </div>
          <div>
            <Label>Typ činnosti (volitelné)</Label>
            <Input
              placeholder="např. Svařování"
              value={values.activityType}
              onChange={(e) => setValues({ ...values, activityType: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            disabled={props.busy || !values.name.trim()}
            onClick={() => void props.onSubmit(values)}
          >
            {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
