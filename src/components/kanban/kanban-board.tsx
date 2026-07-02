"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { ContactJourney, FunnelStage } from "@/types";
import { LeadCard } from "./lead-card";

interface KanbanBoardProps {
  stages: FunnelStage[];
  journeys: ContactJourney[];
  onJourneyMoved: (journeyId: string, newStageId: string) => void;
  onOpenJourney: (journey: ContactJourney) => void;
}

export function KanbanBoard({
  stages,
  journeys,
  onJourneyMoved,
  onOpenJourney,
}: KanbanBoardProps) {
  const [activeJourneyId, setActiveJourneyId] = useState<string | null>(null);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );

  const journeysByStage = useMemo(() => {
    const map = new Map<string, ContactJourney[]>();
    for (const stage of sortedStages) map.set(stage.id, []);
    for (const journey of journeys) {
      const bucket = map.get(journey.stage_id);
      if (bucket) bucket.push(journey);
    }
    return map;
  }, [sortedStages, journeys]);

  const sensors = useSensors(
    // 5px activation distance avoids clicks being interpreted as drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const activeJourney = activeJourneyId
    ? journeys.find((j) => j.id === activeJourneyId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveJourneyId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveJourneyId(null);
    const { active, over } = event;
    if (!over) return;
    const journeyId = String(active.id);
    const targetStageId = String(over.id);

    const journey = journeys.find((j) => j.id === journeyId);
    if (!journey || journey.stage_id === targetStageId) return;
    if (!sortedStages.some((s) => s.id === targetStageId)) return;

    onJourneyMoved(journeyId, targetStageId);
  }

  function handleDragCancel() {
    setActiveJourneyId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="kanban-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 lg:snap-none">
        {sortedStages.map((stage) => {
          const stageJourneys = journeysByStage.get(stage.id) ?? [];
          return (
            <StageColumn
              key={stage.id}
              stage={stage}
              journeys={stageJourneys}
              onOpenJourney={onOpenJourney}
            />
          );
        })}
      </div>

      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        {activeJourney ? (
          <div className="opacity-90">
            <LeadCard
              journey={activeJourney}
              stage={
                sortedStages.find((s) => s.id === activeJourney.stage_id) ?? null
              }
              onOpen={() => {}}
              isOverlay
            />
          </div>
        ) : null}
      </DragOverlay>

      <style jsx>{`
        .kanban-scroll {
          scroll-behavior: smooth;
        }
        @media (hover: none), (pointer: coarse) {
          .kanban-scroll::-webkit-scrollbar {
            height: 0;
            display: none;
          }
          .kanban-scroll {
            scrollbar-width: none;
          }
        }
        @media (hover: hover) and (pointer: fine) {
          .kanban-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--border) transparent;
          }
          .kanban-scroll::-webkit-scrollbar {
            height: 8px;
          }
          .kanban-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .kanban-scroll::-webkit-scrollbar-thumb {
            background-color: var(--border);
            border-radius: 9999px;
          }
          .kanban-scroll::-webkit-scrollbar-thumb:hover {
            background-color: var(--muted-foreground);
          }
        }
      `}</style>
    </DndContext>
  );
}

function StageColumn({
  stage,
  journeys,
  onOpenJourney,
}: {
  stage: FunnelStage;
  journeys: ContactJourney[];
  onOpenJourney: (journey: ContactJourney) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div className="flex w-[85vw] min-w-[260px] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border border-border bg-card/60 p-4 lg:w-auto lg:max-w-none lg:flex-1 lg:basis-[260px] lg:shrink lg:snap-none">
      {/* 3px colored top border — sits above the column's padding */}
      <div
        className="-mx-4 -mt-4 h-[3px] rounded-t-xl"
        style={{ backgroundColor: stage.color }}
      />
      <div className="flex items-center justify-between pt-3">
        <h3 className="truncate text-sm font-semibold text-foreground">
          {stage.name}
        </h3>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {journeys.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`mt-3 flex flex-1 flex-col gap-2 rounded-lg transition-all ${
          isOver
            ? "bg-primary/5 outline outline-2 outline-dashed outline-primary outline-offset-2"
            : ""
        }`}
      >
        {journeys.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            No leads here
          </div>
        ) : (
          journeys.map((journey) => (
            <DraggableLeadCard
              key={journey.id}
              journey={journey}
              stage={stage}
              onOpen={onOpenJourney}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DraggableLeadCard({
  journey,
  stage,
  onOpen,
}: {
  journey: ContactJourney;
  stage: FunnelStage;
  onOpen: (journey: ContactJourney) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: journey.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: "none" }}
    >
      <LeadCard journey={journey} stage={stage} onOpen={onOpen} />
    </div>
  );
}
