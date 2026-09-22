"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { doc } from "firebase/firestore";
import { useDoc, useFirestore, useMemoFirebase, useCompany, useUser } from "@/firebase";
import { getEffectiveModulesMerged } from "@/lib/platform-access";
import { useMergedPlatformModuleCatalog } from "@/contexts/platform-module-catalog-context";
import { buildMobileHomeTiles, type MobileHomeTile } from "@/lib/portal-mobile-home-nav";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
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
import { normalizeDashboardModuleOrder } from "@/lib/portal-user-preferences";
import { usePortalUserPreferences } from "@/hooks/use-portal-user-preferences";

/** Klíče dlaždic pro badge — `tasks`, `chat`, `calendar`, … */
export type MobileModuleTileId = string;

const tileButtonClass =
  "group relative flex h-[100px] w-full flex-col rounded-2xl border border-white/10 bg-white/[0.04] px-2.5 py-3 text-center shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur active:scale-[0.99] transition-transform";

const tileLinkClass =
  "group relative flex h-[100px] flex-col rounded-2xl border border-white/10 bg-white/[0.04] px-2.5 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur active:scale-[0.99] transition-transform min-w-0";

function ModuleIconCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count > 99 ? "99+" : String(count);
  return (
    <span
      className="pointer-events-none absolute -right-0.5 -top-0.5 z-10 flex min-h-[1.125rem] min-w-[1.125rem] max-w-[2.25rem] items-center justify-center rounded-sm bg-red-600 px-0.5 text-[10px] font-bold leading-none text-white shadow-sm ring-1 ring-black/30"
      aria-label={`Počet: ${label}`}
    >
      {label}
    </span>
  );
}

function TileBody({
  t,
  badgeCount,
}: {
  t: MobileHomeTile;
  badgeCount: number;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center min-w-0 w-full">
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-b from-orange-500/20 to-transparent">
        <t.Icon className="h-5 w-5 text-orange-300" />
        <ModuleIconCountBadge count={badgeCount} />
      </div>
      <p className="mt-2 w-full text-[11px] font-semibold leading-tight text-white line-clamp-2 px-0.5">
        {t.title}
      </p>
    </div>
  );
}

function SortableModuleTile({
  t,
  badgeCount,
  reorderMode,
  onOpenSchedule,
  onLongPressStart,
}: {
  t: MobileHomeTile;
  badgeCount: number;
  reorderMode: boolean;
  onOpenSchedule?: () => void;
  onLongPressStart: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: t.key,
    disabled: !reorderMode,
  });
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const pointerHandlers = reorderMode
    ? { ...attributes, ...listeners }
    : {
        onPointerDown: () => {
          clearLongPress();
          longPressTimer.current = setTimeout(() => {
            onLongPressStart();
          }, 480);
        },
        onPointerUp: clearLongPress,
        onPointerLeave: clearLongPress,
        onPointerCancel: clearLongPress,
      };

  const body = <TileBody t={t} badgeCount={badgeCount} />;

  const className = cn(
    t.openSchedule && onOpenSchedule ? tileButtonClass : tileLinkClass,
    isDragging && "z-20 ring-2 ring-orange-500/50 opacity-95 scale-[1.02]",
    reorderMode && "cursor-grab active:cursor-grabbing"
  );

  const shell = (
    <>
      {reorderMode ? (
        <span className="absolute left-1 top-1 z-10 flex h-6 w-5 items-center justify-center text-orange-300/80">
          <GripVertical className="h-3.5 w-3.5" aria-hidden />
        </span>
      ) : null}
      {reorderMode ? (
        body
      ) : t.openSchedule && onOpenSchedule ? (
        <button type="button" className="h-full w-full" onClick={() => onOpenSchedule()}>
          {body}
        </button>
      ) : t.openSchedule ? (
        <Link href="/portal/dashboard" className="block h-full w-full">
          {body}
        </Link>
      ) : (
        <Link href={t.href ?? "/portal/dashboard"} className="block h-full w-full">
          {body}
        </Link>
      )}
    </>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("relative min-w-0", className)}
      {...pointerHandlers}
    >
      {shell}
    </div>
  );
}

export function MobileModuleGrid(props: {
  role?: string;
  onOpenSchedule?: () => void;
  moduleBadgeCounts?: Partial<Record<MobileModuleTileId, number>>;
}) {
  const role = String(props.role || "employee");
  const { company, companyId } = useCompany();
  const { user } = useUser();
  const firestore = useFirestore();
  const platformCatalog = useMergedPlatformModuleCatalog();
  const effectiveModules = useMemo(() => getEffectiveModulesMerged(company), [company]);
  const { preferences, setDashboardModuleOrder } = usePortalUserPreferences();

  const userRef = useMemoFirebase(
    () => (firestore && user ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: userProfile } = useDoc(userRef);
  const employeeId = userProfile?.employeeId;
  const employeeDocRef = useMemoFirebase(
    () =>
      firestore && companyId && employeeId
        ? doc(firestore, "companies", companyId, "employees", String(employeeId))
        : null,
    [firestore, companyId, employeeId]
  );
  const { data: employeeRow } = useDoc<Record<string, unknown>>(employeeDocRef);

  const visible = useMemo(() => {
    const menuCtx = {
      role,
      globalRoles: (userProfile?.globalRoles as string[] | undefined) ?? undefined,
      company,
      effectiveModules,
      platformCatalog,
      employeeRow: employeeRow ?? null,
    };
    return buildMobileHomeTiles({
      role,
      globalRoles: (userProfile?.globalRoles as string[] | undefined) ?? undefined,
      employeeRow: employeeRow ?? null,
      menuCtx,
    });
  }, [role, userProfile?.globalRoles, company, effectiveModules, platformCatalog, employeeRow]);

  const visibleByKey = useMemo(() => {
    const m = new Map<string, MobileHomeTile>();
    for (const t of visible) m.set(t.key, t);
    return m;
  }, [visible]);

  const defaultKeys = useMemo(() => visible.map((t) => t.key), [visible]);

  const orderedKeys = useMemo(
    () => normalizeDashboardModuleOrder(preferences.dashboardModuleOrder, defaultKeys),
    [preferences.dashboardModuleOrder, defaultKeys]
  );

  const orderedTiles = useMemo(
    () => orderedKeys.map((k) => visibleByKey.get(k)).filter(Boolean) as MobileHomeTile[],
    [orderedKeys, visibleByKey]
  );

  const [reorderMode, setReorderMode] = useState(false);
  const [localOrder, setLocalOrder] = useState<string[]>(orderedKeys);

  useEffect(() => {
    if (!reorderMode) setLocalOrder(orderedKeys);
  }, [orderedKeys, reorderMode]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setLocalOrder((prev) => {
        const oldIndex = prev.indexOf(String(active.id));
        const newIndex = prev.indexOf(String(over.id));
        if (oldIndex < 0 || newIndex < 0) return prev;
        return arrayMove(prev, oldIndex, newIndex);
      });
    },
    []
  );

  const finishReorder = () => {
    void setDashboardModuleOrder(localOrder);
    setReorderMode(false);
  };

  const badges = props.moduleBadgeCounts ?? {};

  return (
    <section aria-label="Moduly" className="space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-slate-200">Moduly</h2>
        <div className="flex items-center gap-2">
          {reorderMode ? (
            <Button
              type="button"
              size="sm"
              className="h-8 bg-orange-600 hover:bg-orange-700 text-white"
              onClick={finishReorder}
            >
              Hotovo
            </Button>
          ) : (
            <Badge variant="secondary" className="border-white/10 bg-white/5 text-slate-200">
              {orderedTiles.length}
            </Badge>
          )}
        </div>
      </div>
      {reorderMode ? (
        <p className="text-[11px] text-slate-400">Přetáhněte moduly do pořadí, které vám vyhovuje.</p>
      ) : (
        <p className="text-[11px] text-slate-500">Dlouze podržte dlaždici pro úpravu pořadí.</p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={localOrder} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-4 gap-2 sm:gap-3 min-w-0 w-full">
            {localOrder.map((key) => {
              const t = visibleByKey.get(key);
              if (!t) return null;
              const badgeCount = Math.max(0, Math.floor(Number(badges[t.key]) || 0));
              return (
                <SortableModuleTile
                  key={t.key}
                  t={t}
                  badgeCount={badgeCount}
                  reorderMode={reorderMode}
                  onOpenSchedule={props.onOpenSchedule}
                  onLongPressStart={() => setReorderMode(true)}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
