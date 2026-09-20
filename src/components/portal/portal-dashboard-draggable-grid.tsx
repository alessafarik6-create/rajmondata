"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardWidgetId } from "@/lib/dashboard-widget-layout";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";

export type DashboardWidgetSlot = {
  id: DashboardWidgetId;
  node: React.ReactNode;
  colSpanClass?: string;
};

type Props = {
  slots: DashboardWidgetSlot[];
  order: DashboardWidgetId[];
  onOrderChange: (next: DashboardWidgetId[]) => void | Promise<void>;
  onResetLayout: () => void | Promise<void>;
  dragEnabled?: boolean;
};

function SortableWidget({
  id,
  children,
  colSpanClass,
  dragEnabled,
}: {
  id: string;
  children: React.ReactNode;
  colSpanClass?: string;
  dragEnabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !dragEnabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "min-w-0 relative group",
        colSpanClass,
        isDragging && "z-20 opacity-90"
      )}
    >
      {dragEnabled ? (
        <button
          type="button"
          className="absolute left-1 top-2 z-10 flex h-7 w-6 cursor-grab items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-muted/80 group-hover:opacity-100 active:cursor-grabbing"
          aria-label="Přesunout kartu"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
      {children}
    </div>
  );
}

export function PortalDashboardDraggableGrid({
  slots,
  order,
  onOrderChange,
  onResetLayout,
  dragEnabled = true,
}: Props) {
  const slotById = useMemo(() => {
    const m = new Map<DashboardWidgetId, DashboardWidgetSlot>();
    for (const s of slots) m.set(s.id, s);
    return m;
  }, [slots]);

  const visibleIds = useMemo(() => {
    const ids = order.filter((id) => slotById.has(id));
    for (const s of slots) {
      if (!ids.includes(s.id)) ids.push(s.id);
    }
    return ids;
  }, [order, slotById, slots]);

  const [localOrder, setLocalOrder] = useState(visibleIds);
  useEffect(() => {
    setLocalOrder(visibleIds);
  }, [visibleIds.join(",")]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localOrder.indexOf(active.id as DashboardWidgetId);
    const newIndex = localOrder.indexOf(over.id as DashboardWidgetId);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(localOrder, oldIndex, newIndex);
    setLocalOrder(next);
    void onOrderChange(next);
  };

  const gridClass =
    "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-5 auto-rows-fr";

  return (
    <div className="space-y-2">
      {dragEnabled ? (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground">
                <MoreHorizontal className="h-4 w-4" />
                Dashboard
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void onResetLayout()}>
                Obnovit výchozí rozložení
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={localOrder} strategy={rectSortingStrategy}>
          <div className={gridClass}>
            {localOrder.map((id) => {
              const slot = slotById.get(id);
              if (!slot) return null;
              return (
                <SortableWidget
                  key={id}
                  id={id}
                  colSpanClass={slot.colSpanClass}
                  dragEnabled={dragEnabled}
                >
                  {slot.node}
                </SortableWidget>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
