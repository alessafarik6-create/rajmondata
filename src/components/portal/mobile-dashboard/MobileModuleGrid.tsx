"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { doc } from "firebase/firestore";
import { useDoc, useFirestore, useMemoFirebase, useCompany, useUser } from "@/firebase";
import { getEffectiveModulesMerged } from "@/lib/platform-access";
import { useMergedPlatformModuleCatalog } from "@/contexts/platform-module-catalog-context";
import { buildMobileHomeTiles, type MobileHomeTile } from "@/lib/portal-mobile-home-nav";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
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

/** Klíče dlažic pro badge — `tasks`, `chat`, `calendar`, … */
export type MobileModuleTileId = string;

const LONG_PRESS_MS = 400;

const tileSurfaceClass =
  "group relative flex h-[100px] w-full flex-col rounded-2xl border border-white/10 bg-white/[0.04] px-2.5 py-3 text-center shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur min-w-0";

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

function TileBody({ t, badgeCount }: { t: MobileHomeTile; badgeCount: number }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center min-w-0 w-full pointer-events-none">
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
  isDragActive,
  onOpenSchedule,
  navigate,
  blockTapRef,
}: {
  t: MobileHomeTile;
  badgeCount: number;
  reorderMode: boolean;
  isDragActive: boolean;
  onOpenSchedule?: () => void;
  navigate: () => void;
  blockTapRef: React.MutableRefObject<boolean>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: t.key,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dragActive = reorderMode || isDragActive;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        tileSurfaceClass,
        dragActive ? "touch-none cursor-grab active:cursor-grabbing" : "touch-pan-y",
        isDragging && "z-30 ring-2 ring-orange-500/60 opacity-95 scale-[1.04] shadow-2xl",
        reorderMode && !isDragging && "ring-1 ring-orange-500/30"
      )}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (blockTapRef.current || isDragging || reorderMode) return;
        if (t.openSchedule && onOpenSchedule) {
          onOpenSchedule();
          return;
        }
        navigate();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!dragActive) navigate();
        }
      }}
    >
      {dragActive ? (
        <span className="absolute left-1 top-1 z-10 flex h-6 w-5 items-center justify-center text-orange-300/90">
          <GripVertical className="h-3.5 w-3.5" aria-hidden />
        </span>
      ) : null}
      <TileBody t={t} badgeCount={badgeCount} />
    </div>
  );
}

function TilePreview({ t, badgeCount }: { t: MobileHomeTile; badgeCount: number }) {
  return (
    <div className={cn(tileSurfaceClass, "scale-[1.04] ring-2 ring-orange-500/60 shadow-2xl")}>
      <TileBody t={t} badgeCount={badgeCount} />
    </div>
  );
}

export function MobileModuleGrid(props: {
  role?: string;
  onOpenSchedule?: () => void;
  moduleBadgeCounts?: Partial<Record<MobileModuleTileId, number>>;
}) {
  const router = useRouter();
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

  const [reorderMode, setReorderMode] = useState(false);
  const [localOrder, setLocalOrder] = useState<string[]>(orderedKeys);
  const [activeId, setActiveId] = useState<string | null>(null);
  const dragStartedRef = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number; key: string } | null>(null);

  useEffect(() => {
    if (!reorderMode) setLocalOrder(orderedKeys);
  }, [orderedKeys, reorderMode]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: reorderMode ? { distance: 4 } : { distance: 9999 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: reorderMode
        ? { delay: 0, tolerance: 6 }
        : { delay: LONG_PRESS_MS, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const persistOrder = useCallback(
    (next: string[]) => {
      void setDashboardModuleOrder(next);
    },
    [setDashboardModuleOrder]
  );

  const onDragStart = useCallback((event: DragStartEvent) => {
    dragStartedRef.current = true;
    setActiveId(String(event.active.id));
    if (!reorderMode) {
      setReorderMode(true);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(12);
      }
    }
  }, [reorderMode]);

  const onDragMove = useCallback((event: DragMoveEvent) => {
    const rect = event.active.rect.current.translated;
    if (!rect) return;
    const y = rect.top + rect.height / 2;
    const margin = 72;
    const vh = window.innerHeight;
    if (y < margin) window.scrollBy(0, -14);
    else if (y > vh - margin) window.scrollBy(0, 14);
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (over && active.id !== over.id) {
        setLocalOrder((prev) => {
          const oldIndex = prev.indexOf(String(active.id));
          const newIndex = prev.indexOf(String(over.id));
          if (oldIndex < 0 || newIndex < 0) return prev;
          const next = arrayMove(prev, oldIndex, newIndex);
          persistOrder(next);
          return next;
        });
      }
      window.setTimeout(() => {
        dragStartedRef.current = false;
      }, 80);
    },
    [persistOrder]
  );

  const finishReorder = () => {
    persistOrder(localOrder);
    setReorderMode(false);
    setActiveId(null);
  };

  const navigateTile = useCallback(
    (t: MobileHomeTile) => {
      if (t.openSchedule && props.onOpenSchedule) {
        props.onOpenSchedule();
        return;
      }
      const href = t.openSchedule ? "/portal/dashboard" : (t.href ?? "/portal/dashboard");
      router.push(href);
    },
    [props.onOpenSchedule, router]
  );

  const handlePointerDownOnGrid = (key: string, e: React.PointerEvent) => {
    if (reorderMode || dragStartedRef.current) return;
    pointerDownRef.current = { x: e.clientX, y: e.clientY, key };
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      setReorderMode(true);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(12);
      }
    }, LONG_PRESS_MS);
  };

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    pointerDownRef.current = null;
  };

  const badges = props.moduleBadgeCounts ?? {};
  const activeTile = activeId ? visibleByKey.get(activeId) : null;

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
              {localOrder.length}
            </Badge>
          )}
        </div>
      </div>
      {reorderMode ? (
        <p className="text-[11px] text-slate-400">Táhněte prstem — pořadí se ukládá automaticky.</p>
      ) : (
        <p className="text-[11px] text-slate-500">
          Podržte dlaždici {LONG_PRESS_MS / 1000}s a táhněte prstem.
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          dragStartedRef.current = false;
        }}
      >
        <SortableContext items={localOrder} strategy={rectSortingStrategy}>
          <div
            className="grid grid-cols-4 gap-2 sm:gap-3 min-w-0 w-full"
            onPointerDownCapture={(e) => {
              const el = (e.target as HTMLElement).closest("[data-tile-key]");
              const key = el?.getAttribute("data-tile-key");
              if (key) handlePointerDownOnGrid(key, e);
            }}
            onPointerUpCapture={clearLongPress}
            onPointerCancelCapture={clearLongPress}
          >
            {localOrder.map((key) => {
              const t = visibleByKey.get(key);
              if (!t) return null;
              const badgeCount = Math.max(0, Math.floor(Number(badges[t.key]) || 0));
              return (
                <div key={t.key} data-tile-key={t.key}>
                  <SortableModuleTile
                    t={t}
                    badgeCount={badgeCount}
                    reorderMode={reorderMode}
                    isDragActive={activeId === t.key}
                    onOpenSchedule={props.onOpenSchedule}
                    navigate={() => navigateTile(t)}
                    blockTapRef={dragStartedRef}
                  />
                </div>
              );
            })}
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {activeTile ? (
            <TilePreview
              t={activeTile}
              badgeCount={Math.max(0, Math.floor(Number(badges[activeTile.key]) || 0))}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </section>
  );
}
