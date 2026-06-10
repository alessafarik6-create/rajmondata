"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { JobDetailCollapsibleSection } from "@/components/jobs/job-detail-collapsible-section";
import {
  JOB_DETAIL_COLLAPSIBLE_SECTION_LABELS,
  moveSectionInOrder,
  readJobDetailSectionOpenMap,
  readJobDetailSectionOrder,
  sortSectionsByOrder,
  writeJobDetailSectionOpenMap,
  writeJobDetailSectionOrder,
  type JobDetailCollapsibleSectionId,
} from "@/lib/job-detail-collapsible-sections";

export type JobDetailCollapsibleSectionDef = {
  id: JobDetailCollapsibleSectionId;
  title?: string;
  summary?: React.ReactNode;
  visible: boolean;
  children: React.ReactNode;
};

export function JobDetailCollapsibleSectionsPanel(props: {
  jobId: string;
  userId?: string | null;
  sections: JobDetailCollapsibleSectionDef[];
}) {
  const { jobId, userId, sections } = props;
  const visibleSections = useMemo(
    () => sections.filter((s) => s.visible),
    [sections]
  );

  const [order, setOrder] = useState<JobDetailCollapsibleSectionId[]>(() =>
    readJobDetailSectionOrder(userId)
  );
  const [openMap, setOpenMap] = useState<
    Partial<Record<JobDetailCollapsibleSectionId, boolean>>
  >(() => readJobDetailSectionOpenMap(userId, jobId));

  useEffect(() => {
    setOrder(readJobDetailSectionOrder(userId));
    setOpenMap(readJobDetailSectionOpenMap(userId, jobId));
  }, [userId, jobId]);

  const ordered = useMemo(
    () => sortSectionsByOrder(visibleSections, order),
    [visibleSections, order]
  );

  const persistOrder = useCallback(
    (next: JobDetailCollapsibleSectionId[]) => {
      setOrder(next);
      writeJobDetailSectionOrder(userId, next);
    },
    [userId]
  );

  const setSectionOpen = useCallback(
    (id: JobDetailCollapsibleSectionId, open: boolean) => {
      setOpenMap((prev) => {
        const next = { ...prev, [id]: open };
        writeJobDetailSectionOpenMap(userId, jobId, next);
        return next;
      });
    },
    [userId, jobId]
  );

  if (ordered.length === 0) return null;

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 sm:gap-3.5">
      {ordered.map((section, index) => {
        const title = section.title ?? JOB_DETAIL_COLLAPSIBLE_SECTION_LABELS[section.id];
        const open = openMap[section.id] === true;
        return (
          <JobDetailCollapsibleSection
            key={section.id}
            id={section.id}
            title={title}
            summary={section.summary}
            open={open}
            onOpenChange={(v) => setSectionOpen(section.id, v)}
            onMoveUp={() =>
              persistOrder(moveSectionInOrder(order, section.id, "up"))
            }
            onMoveDown={() =>
              persistOrder(moveSectionInOrder(order, section.id, "down"))
            }
            canMoveUp={index > 0}
            canMoveDown={index < ordered.length - 1}
          >
            {section.children}
          </JobDetailCollapsibleSection>
        );
      })}
    </div>
  );
}
