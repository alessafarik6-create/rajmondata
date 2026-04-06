"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  parseAnswersMap,
  validateQuestionnaireAnswers,
  type JobQuestionnaireQuestion,
  type JobQuestionnaireTemplate,
  type QuestionnaireAnswerValue,
} from "@/lib/job-customer-questionnaire";
import { completeCustomerTasksByTypes, readJobQuestionnaireSnapshot } from "@/lib/customer-job-tasks";
import { Loader2 } from "lucide-react";

type Props = {
  companyId: string;
  jobId: string;
  customerUid: string;
  customerId: string | null | undefined;
  jobData: Record<string, unknown> | null | undefined;
};

export function CustomerJobQuestionnaireSection({
  companyId,
  jobId,
  customerUid,
  customerId,
  jobData,
}: Props) {
  const firestore = useFirestore();
  const [initDone, setInitDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const tpl = useMemo(() => readJobQuestionnaireSnapshot(jobData ?? null), [jobData]);

  const responseRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId && customerUid
        ? doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId,
            "customer_questionnaire_responses",
            customerUid
          )
        : null,
    [firestore, companyId, jobId, customerUid]
  );

  const { data: responseRaw, isLoading: responseLoading } = useDoc(responseRef);

  const questions = useMemo(() => {
    const q = (responseRaw as { questions?: unknown } | null)?.questions;
    if (!Array.isArray(q)) return [] as JobQuestionnaireQuestion[];
    return q as JobQuestionnaireQuestion[];
  }, [responseRaw]);

  const status = String((responseRaw as { status?: string } | null)?.status ?? "");
  const locked = status === "submitted";

  const [answers, setAnswers] = useState<Record<string, QuestionnaireAnswerValue>>({});

  useEffect(() => {
    const raw = (responseRaw as { answers?: unknown } | null)?.answers;
    setAnswers(parseAnswersMap(raw));
  }, [responseRaw]);

  useEffect(() => {
    if (!firestore || !companyId || !jobId || !customerUid || !tpl || tpl.active === false) {
      setInitDone(true);
      return;
    }
    if (!tpl.questions?.length) {
      setInitDone(true);
      return;
    }
    if (responseLoading) return;
    if (responseRaw) {
      setInitDone(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await setDoc(
          doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId,
            "customer_questionnaire_responses",
            customerUid
          ),
          {
            companyId,
            jobId,
            customerPortalUid: customerUid,
            customerId: customerId ?? null,
            templateId: tpl.templateId ?? null,
            title: tpl.title,
            description: tpl.description ?? "",
            questions: tpl.questions,
            answers: {},
            status: "draft",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }
        );
      } catch (e) {
        console.error("[CustomerJobQuestionnaireSection] init", e);
      } finally {
        if (!cancelled) setInitDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    firestore,
    companyId,
    jobId,
    customerUid,
    customerId,
    tpl,
    responseRaw,
    responseLoading,
  ]);

  const persist = useCallback(
    async (nextAnswers: Record<string, QuestionnaireAnswerValue>, nextStatus: "draft" | "submitted") => {
      if (!firestore || !responseRef || !tpl) return;
      setSaving(true);
      try {
        await setDoc(
          responseRef,
          {
            answers: nextAnswers,
            status: nextStatus,
            updatedAt: serverTimestamp(),
            ...(nextStatus === "submitted" ? { submittedAt: serverTimestamp() } : {}),
          },
          { merge: true }
        );
        if (nextStatus === "submitted") {
          await completeCustomerTasksByTypes(firestore, companyId, jobId, customerUid, [
            "fill_questionnaire",
          ]);
        }
      } finally {
        setSaving(false);
      }
    },
    [firestore, responseRef, tpl, companyId, jobId, customerUid]
  );

  const onSubmit = async () => {
    if (!tpl?.questions?.length || locked) return;
    const errs = validateQuestionnaireAnswers(tpl.questions, answers);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    await persist(answers, "submitted");
    setFieldErrors({});
  };

  const onSaveDraft = async () => {
    if (locked) return;
    setFieldErrors({});
    await persist(answers, "draft");
  };

  const setAnswer = (q: JobQuestionnaireQuestion, v: QuestionnaireAnswerValue | undefined) => {
    setAnswers((prev) => {
      const next = { ...prev };
      if (v === undefined) delete next[q.id];
      else next[q.id] = v;
      return next;
    });
  };

  if (!tpl || tpl.active === false || !tpl.questions?.length) {
    return null;
  }

  if (!initDone || responseLoading) {
    return (
      <Card id="customer-questionnaire">
        <CardContent className="flex justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Načítání dotazníku" />
        </CardContent>
      </Card>
    );
  }

  if (!responseRaw) {
    return (
      <Card id="customer-questionnaire">
        <CardHeader>
          <CardTitle>Dotazník</CardTitle>
          <CardDescription>Dotazník se nepodařilo inicializovat. Zkuste obnovit stránku.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const title =
    typeof (responseRaw as { title?: string }).title === "string"
      ? (responseRaw as { title: string }).title
      : tpl.title;
  const description =
    typeof (responseRaw as { description?: string }).description === "string"
      ? (responseRaw as { description: string }).description
      : tpl.description;

  const sortedQs = [...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <Card id="customer-questionnaire" className="scroll-mt-4">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {locked ? (
          <p className="text-sm font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
            Dotazník byl odeslán. Úpravy již nejsou možné.
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6">
        {sortedQs.map((q) => {
          const err = fieldErrors[q.id];
          const baseLabel = (
            <Label className="text-base font-medium leading-snug">
              {q.label}
              {q.required ? <span className="text-destructive ml-0.5">*</span> : null}
            </Label>
          );
          const v = answers[q.id];

          const wrapCls = cn("space-y-2", err && "rounded-md ring-2 ring-destructive/40 p-3 -m-1");

          if (q.type === "long_text") {
            return (
              <div key={q.id} className={wrapCls}>
                {baseLabel}
                <Textarea
                  disabled={locked}
                  className="min-h-[100px]"
                  placeholder={q.placeholder}
                  value={typeof v === "string" ? v : ""}
                  onChange={(e) => setAnswer(q, e.target.value)}
                />
                {err ? <p className="text-sm text-destructive">{err}</p> : null}
              </div>
            );
          }

          if (q.type === "radio") {
            const val = typeof v === "string" ? v : "";
            return (
              <div key={q.id} className={wrapCls}>
                {baseLabel}
                <RadioGroup
                  disabled={locked}
                  value={val}
                  onValueChange={(x) => setAnswer(q, x)}
                  className="grid gap-3"
                >
                  {(q.options ?? []).map((o) => (
                    <label
                      key={o.value}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm",
                        locked && "opacity-60 pointer-events-none"
                      )}
                    >
                      <RadioGroupItem value={o.value} id={`${q.id}-${o.value}`} className="mt-1" />
                      <span className="text-sm leading-snug">{o.label}</span>
                    </label>
                  ))}
                </RadioGroup>
                {err ? <p className="text-sm text-destructive">{err}</p> : null}
              </div>
            );
          }

          if (q.type === "checkbox_multi") {
            const arr = Array.isArray(v) ? v : [];
            const opts = q.options ?? [];
            return (
              <div key={q.id} className={wrapCls}>
                {baseLabel}
                <div className="grid gap-2">
                  {opts.map((o) => {
                    const checked = arr.includes(o.value);
                    return (
                      <label
                        key={o.value}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3",
                          locked && "opacity-60 pointer-events-none"
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-slate-300"
                          disabled={locked}
                          checked={checked}
                          onChange={() => {
                            const next = new Set(arr);
                            if (checked) next.delete(o.value);
                            else next.add(o.value);
                            setAnswer(q, Array.from(next));
                          }}
                        />
                        <span className="text-sm">{o.label}</span>
                      </label>
                    );
                  })}
                </div>
                {err ? <p className="text-sm text-destructive">{err}</p> : null}
              </div>
            );
          }

          if (q.type === "date" || q.type === "birth_date") {
            const s = typeof v === "string" ? v : "";
            return (
              <div key={q.id} className={wrapCls}>
                {baseLabel}
                <Input
                  type="date"
                  disabled={locked}
                  value={s}
                  onChange={(e) => setAnswer(q, e.target.value)}
                />
                {err ? <p className="text-sm text-destructive">{err}</p> : null}
              </div>
            );
          }

          if (q.type === "number") {
            const n = typeof v === "number" ? String(v) : typeof v === "string" ? v : "";
            return (
              <div key={q.id} className={wrapCls}>
                {baseLabel}
                <Input
                  type="number"
                  disabled={locked}
                  placeholder={q.placeholder}
                  value={n}
                  onChange={(e) => {
                    const t = e.target.value;
                    setAnswer(q, t === "" ? undefined : Number(t));
                  }}
                />
                {err ? <p className="text-sm text-destructive">{err}</p> : null}
              </div>
            );
          }

          if (q.type === "yes_no") {
            const b = v === true || v === false ? v : false;
            return (
              <div key={q.id} className={wrapCls}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {baseLabel}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Ne</span>
                    <Switch
                      disabled={locked}
                      checked={b === true}
                      onCheckedChange={(c) => setAnswer(q, c)}
                    />
                    <span className="text-sm text-muted-foreground">Ano</span>
                  </div>
                </div>
                {err ? <p className="text-sm text-destructive">{err}</p> : null}
              </div>
            );
          }

          return (
            <div key={q.id} className={wrapCls}>
              {baseLabel}
              <Input
                disabled={locked}
                placeholder={q.placeholder}
                value={typeof v === "string" ? v : ""}
                onChange={(e) => setAnswer(q, e.target.value)}
              />
              {err ? <p className="text-sm text-destructive">{err}</p> : null}
            </div>
          );
        })}

        {!locked ? (
          <div className="flex flex-wrap gap-3 pt-2">
            <Button type="button" variant="outline" disabled={saving} onClick={() => void onSaveDraft()}>
              Uložit rozpracované
            </Button>
            <Button type="button" disabled={saving} onClick={() => void onSubmit()}>
              Odeslat dotazník
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
