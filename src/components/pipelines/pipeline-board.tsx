"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  rectIntersection,
  AutoScrollActivator,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Deal, PipelineStage } from "@/types";
import { DealCard } from "./deal-card";
import { useTranslations } from "next-intl";

/** Row shape persisted on drop — `handleDealsReordered` writes exactly
 *  these two columns per deal (see pipelines/page.tsx). Deliberately not
 *  an upsert: `deals` has several other NOT NULL columns
 *  (user_id/pipeline_id/title) and an RLS INSERT policy that requires
 *  `account_id` in the payload — `INSERT ... ON CONFLICT DO UPDATE`
 *  validates the INSERT branch (both the NOT NULL constraints and the
 *  INSERT policy's WITH CHECK) even though every one of these rows
 *  already exists and only the UPDATE branch ever actually runs. A plain
 *  per-row UPDATE has no insert branch to satisfy, so it only needs
 *  these two columns. */
export interface DealPositionUpdate {
  id: string;
  stage_id: string;
  position: number;
}

interface PipelineBoardProps {
  stages: PipelineStage[];
  deals: Deal[];
  onDealsReordered: (rows: DealPositionUpdate[]) => void;
  // `originRect` (the clicked card's own bounding box) rides along so the
  // deal detail panel can open with a FLIP animation that visually grows
  // out of the card instead of just fading/zooming in centered.
  onEditDeal: (deal: Deal, originRect?: DOMRect) => void;
  onRequestDeleteDeal: (deal: Deal) => void;
}

/** Per-stage ordered id lists — the only thing that mutates at drag speed.
 *  Keeping this to ids (not full `Deal` objects) is what keeps onDragOver
 *  cheap: no re-deriving/re-sorting the real `deals` array every time the
 *  pointer crosses into a new column. */
type DragState = Record<string, string[]>;

function findContainer(state: DragState, id: string): string | undefined {
  // Hovering a column's own empty-state droppable reports `id` as the
  // stage id directly (see StageColumn's `useDroppable`) — a hit there
  // resolves the container in one step, no scan needed.
  if (id in state) return id;
  return Object.keys(state).find((stageId) => state[stageId].includes(id));
}

// Standard dnd-kit "multiple containers" recipe: try a pointer-based hit
// first (accurate once cards + the empty-column droppable coexist in the
// same pass — `closestCorners`/`closestCenter` alone get unstable there),
// falling back to rect intersection only when the pointer isn't over
// anything (e.g. it's out past the last card in a short column).
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
};

export function PipelineBoard({
  stages,
  deals,
  onDealsReordered,
  onEditDeal,
  onRequestDeleteDeal,
}: PipelineBoardProps) {
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  // Non-null only for the duration of a drag — see handleDragStart/End.
  const [dragState, setDragState] = useState<DragState | null>(null);

  // Horizontal auto-scroll — hand-rolled and kept fully separate from
  // dnd-kit's own `autoScroll` (below), which stays exactly as configured
  // for the columns' vertical scroll (untouched, already working well).
  // dnd-kit's single `interval`/`acceleration`/`threshold` apply uniformly
  // to every scrollable ancestor it manages, so tuning the row to feel
  // fast enough to cross several columns would have meant re-tuning
  // vertical too. Excluding the row from dnd-kit's own autoscroll (via
  // `canScroll` below) and driving it from this rAF loop instead lets the
  // two axes have completely independent feel with zero risk of the two
  // mechanisms fighting over the same element's scrollLeft.
  const rowRef = useRef<HTMLDivElement>(null);
  const pointerXRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activeDealId) {
      pointerXRef.current = null;
      return;
    }

    // Track the raw pointer position via a native listener (not React
    // props) — this only needs the latest X, so there's nothing to
    // re-render on and no reason to route it through dnd-kit's own event
    // callbacks. Pointer Events cover mouse and touch alike.
    function handlePointerMove(e: PointerEvent) {
      pointerXRef.current = e.clientX;
    }
    document.addEventListener("pointermove", handlePointerMove);

    // Distance from the row's edge (px) where scrolling starts, and the
    // fastest speed reached right at the edge — both tuned so a drag can
    // cross several 260px columns in well under a second without feeling
    // twitchy near the threshold's outer edge.
    const EDGE_ZONE_PX = 120;
    const MAX_SPEED_PX_PER_FRAME = 26;

    let rafId: number;
    function tick() {
      const row = rowRef.current;
      const x = pointerXRef.current;
      if (row && x != null) {
        const rect = row.getBoundingClientRect();
        let speed = 0;
        if (x < rect.left + EDGE_ZONE_PX) {
          // Proximity ramps 0 → 1 as the pointer nears the edge, so
          // acceleration is progressive, not a flat on/off speed.
          const proximity = 1 - Math.max(0, x - rect.left) / EDGE_ZONE_PX;
          speed = -MAX_SPEED_PX_PER_FRAME * proximity;
        } else if (x > rect.right - EDGE_ZONE_PX) {
          const proximity = 1 - Math.max(0, rect.right - x) / EDGE_ZONE_PX;
          speed = MAX_SPEED_PX_PER_FRAME * proximity;
        }
        if (speed !== 0) row.scrollLeft += speed;
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      cancelAnimationFrame(rafId);
    };
  }, [activeDealId]);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );

  const dealsById = useMemo(() => {
    const map = new Map<string, Deal>();
    for (const deal of deals) map.set(deal.id, deal);
    return map;
  }, [deals]);

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of sortedStages) map.set(stage.id, []);
    for (const deal of deals) {
      const bucket = map.get(deal.stage_id);
      if (bucket) bucket.push(deal);
    }
    // The page's initial fetch is already `order("position")`, but the
    // optimistic patch after a drop (page.tsx) only updates each moved
    // deal's fields in place — it doesn't re-sort the `deals` array — so
    // this has to sort on every render for the reordered result to show
    // immediately instead of only after the next full refetch.
    for (const bucket of map.values()) bucket.sort((a, b) => a.position - b.position);
    return map;
  }, [sortedStages, deals]);

  // What each column actually renders: the live drag snapshot while a
  // drag is in flight (so the target column shows the card immediately,
  // before drop), the server-ordered list otherwise.
  const columnIds = useMemo(() => {
    if (dragState) return dragState;
    const map: DragState = {};
    for (const stage of sortedStages) {
      map[stage.id] = (dealsByStage.get(stage.id) ?? []).map((d) => d.id);
    }
    return map;
  }, [dragState, sortedStages, dealsByStage]);

  const sensors = useSensors(
    // Mouse: click-and-drag starts immediately (small 4px threshold just
    // filters out a stationary click's natural jitter) — Trello's desktop
    // behavior. Only arms on `mousedown`, so it never competes with
    // TouchSensor below for the same physical gesture.
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // Touch: nothing starts until the finger has held still for ~350ms
    // (Trello's long-press). `tolerance: 8` cancels the pending drag the
    // moment the finger moves more than 8px before that delay elapses —
    // that cancellation, not `touch-action`, is what hands a normal swipe
    // straight back to native scrolling (see SortableDealCard below).
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 8 } }),
    // Keyboard drag support: focus a card, Space to pick up, arrows to move,
    // Space to drop, Escape to cancel. `sortableKeyboardCoordinates` (vs.
    // the plain default) is what makes arrow keys understand sortable-list
    // semantics instead of raw pixel deltas.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeDeal = activeDealId ? dealsById.get(activeDealId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setActiveDealId(id);
    // Snapshot the current order into drag-local state — everything
    // during the drag reads/writes this, not the server-derived `deals`.
    const snapshot: DragState = {};
    for (const stage of sortedStages) {
      snapshot[stage.id] = (dealsByStage.get(stage.id) ?? []).map((d) => d.id);
    }
    setDragState(snapshot);

    // Haptic tick on long-press-confirmed drag, touch-origin only (mouse/
    // keyboard drags never vibrate). iOS Safari/WebKit — including a
    // standalone home-screen PWA — has never implemented the Vibration
    // API; this silently no-ops there and fires normally on Android
    // Chrome. That's a platform limitation, not a bug in this code.
    if (
      typeof navigator !== "undefined" &&
      "vibrate" in navigator &&
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches
    ) {
      navigator.vibrate(15);
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    setDragState((prev) => {
      if (!prev) return prev;
      const activeId = String(active.id);
      const overId = String(over.id);
      const activeContainer = findContainer(prev, activeId);
      const overContainer = findContainer(prev, overId);
      if (!activeContainer || !overContainer || activeContainer === overContainer) {
        return prev;
      }
      const activeItems = prev[activeContainer];
      const overItems = prev[overContainer];
      const activeIndex = activeItems.indexOf(activeId);
      if (activeIndex === -1) return prev;
      const overIndex = overItems.indexOf(overId);
      const newIndex = overIndex >= 0 ? overIndex : overItems.length;
      return {
        ...prev,
        [activeContainer]: activeItems.filter((id) => id !== activeId),
        [overContainer]: [
          ...overItems.slice(0, newIndex),
          activeId,
          ...overItems.slice(newIndex),
        ],
      };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDealId(null);
    const finalState = dragState;
    setDragState(null);

    const { active, over } = event;
    if (!finalState || !over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const container = findContainer(finalState, activeId);
    if (!container) return;

    // Cross-column moves already landed `activeId` in the right container
    // via handleDragOver above; this only still needs to settle its exact
    // position *within* that container against whatever it was dropped on.
    let finalIds = finalState[container];
    const overContainer = findContainer(finalState, overId);
    if (overContainer === container && activeId !== overId) {
      const oldIndex = finalIds.indexOf(activeId);
      const newIndex = finalIds.indexOf(overId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        finalIds = arrayMove(finalIds, oldIndex, newIndex);
      }
    }

    // Persist every column whose membership actually changed: the
    // destination (new order, possibly a new member) and — if different
    // — the origin (lost a member, remaining order unchanged but its
    // positions are recomputed anyway since 1000-stepping is cheap and
    // avoids ever needing a "insert between two adjacent ints" special
    // case later).
    const originalStageId = deals.find((d) => d.id === activeId)?.stage_id;
    const stagesToPersist = new Set([container]);
    if (originalStageId && originalStageId !== container) {
      stagesToPersist.add(originalStageId);
    }

    const rows: DealPositionUpdate[] = [];
    for (const stageId of stagesToPersist) {
      const ids = stageId === container ? finalIds : finalState[stageId];
      ids.forEach((id, index) => {
        rows.push({ id, stage_id: stageId, position: (index + 1) * 1000 });
      });
    }

    if (rows.length > 0) onDealsReordered(rows);
  }

  function handleDragCancel() {
    setActiveDealId(null);
    setDragState(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      // `threshold` is a fraction of each scrollable container's own
      // size (not raw px) — dnd-kit walks every scrollable ancestor of
      // the pointer each frame, so the horizontal row and whichever
      // column the pointer is over both auto-scroll independently,
      // simultaneously, with no extra wiring once each column is a real
      // scroll container (see StageColumn below).
      //
      // `activator: DraggableRect` — edge-proximity is measured against
      // the dragged CARD's own bounding box, not the bare pointer pixel
      // (dnd-kit's default). A card is much bigger than a point, so its
      // nearest edge reaches the threshold zone sooner — you don't have
      // to drag the cursor itself all the way to the screen/column edge
      // for scrolling to kick in, same feel as Trello.
      //
      // `interval: 16` (dnd-kit's own default is 5ms, ~200 scroll ticks/
      // sec) — each tick re-runs collision detection and re-renders
      // every useSortable-subscribed card in the column, so on a column
      // with 20+ leads the default tick rate is measurably more main-
      // thread work than it needs to be. 16ms matches a 60fps frame
      // budget — same visual scroll smoothness, ~3x fewer recalculation
      // passes.
      //
      // `canScroll` excludes the horizontal row specifically — that axis
      // is driven by the standalone rAF loop above instead (tuned
      // independently for "cross several columns fast"), so dnd-kit's
      // own autoscroll here only ever touches the columns' vertical
      // scroll, exactly as before.
      autoScroll={{
        enabled: true,
        activator: AutoScrollActivator.DraggableRect,
        threshold: { x: 0.2, y: 0.2 },
        acceleration: 15,
        interval: 16,
        canScroll: (element) => element !== rowRef.current,
      }}
    >
      {/* snap-x + snap-mandatory on mobile so swipes land the next
          stage cleanly at the viewport edge instead of mid-column.
          Disabled on lg+ where snapping would interfere with the
          natural layout. The board can still overflow horizontally on
          lg+ once a pipeline has many stages (columns keep a 260px
          min-width), so a thin scrollbar stays visible on desktop.
          `h-full` so it fills the bounded-height wrapper the page gives
          it (see pipelines/page.tsx) — columns below stretch to match
          (flex row default `align-items: stretch`), which is what lets
          each column size its own internal vertical scroll area instead
          of the whole page growing. `dragging` suppresses scroll-snap
          for the duration of a drag — CSS scroll-snap (especially iOS's)
          fights programmatic auto-scroll by re-snapping mid-scroll. */}
      <div
        ref={rowRef}
        className={`pipeline-scroll flex h-full snap-x snap-mandatory gap-3 overflow-x-auto pb-4 lg:snap-none ${
          activeDealId ? "dragging" : ""
        }`}
      >
        {sortedStages.map((stage) => {
          const ids = columnIds[stage.id] ?? [];
          const stageDeals = ids
            .map((id) => dealsById.get(id))
            .filter((d): d is Deal => !!d);
          return (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={stageDeals}
              onEditDeal={onEditDeal}
              onRequestDeleteDeal={onRequestDeleteDeal}
            />
          );
        })}
      </div>

      <DragOverlay
        dropAnimation={{
          // Already within the 180–220ms "Snap" spec — unchanged.
          duration: 200,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
          // Mirrors the lift-in below: scale/shadow ease back down to
          // resting as the card glides to its drop position, instead of
          // just the position animating and the scale/shadow snapping
          // off instantly.
          keyframes: ({ transform }) => [
            {
              transform: `${CSS.Transform.toString(transform.initial)} scale(1.03)`,
              boxShadow: "0 12px 24px -4px rgba(0, 0, 0, 0.35)",
            },
            {
              transform: `${CSS.Transform.toString(transform.final)} scale(1)`,
              boxShadow: "0 1px 2px rgba(0, 0, 0, 0.08)",
            },
          ],
        }}
      >
        {activeDeal ? (
          // `deal-lift` (defined below) plays once on mount — a fresh
          // DragOverlay is mounted per drag, so there's no prior state to
          // `transition` from; a CSS animation is what runs a one-shot
          // "grew into place" effect instead.
          <div className="deal-lift">
            <DealCard
              deal={activeDeal}
              stage={
                sortedStages.find((s) => s.id === activeDeal.stage_id) ?? null
              }
              onEdit={() => {}}
              isOverlay
            />
          </div>
        ) : null}
      </DragOverlay>

      <style jsx>{`
        .pipeline-scroll {
          scroll-behavior: smooth;
        }
        /* On touch devices the peek/snap layout already signals there's
           more to swipe, so the scrollbar is hidden for a clean look.
           On desktop (mouse) the board can overflow with many stages
           and there is no peek hint, so keep a thin, themed scrollbar
           visible to make the overflow discoverable and usable. */
        @media (hover: none), (pointer: coarse) {
          .pipeline-scroll::-webkit-scrollbar {
            height: 0;
            display: none;
          }
          .pipeline-scroll {
            scrollbar-width: none;
          }
        }
        @media (hover: hover) and (pointer: fine) {
          .pipeline-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--border) transparent;
          }
          .pipeline-scroll::-webkit-scrollbar {
            height: 8px;
          }
          .pipeline-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb {
            background-color: var(--border);
            border-radius: 9999px;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb:hover {
            background-color: var(--muted-foreground);
          }
        }
        /* Active drag: let JS-driven auto-scroll own scrollLeft without
           the browser re-snapping to the nearest column mid-scroll, and
           without the browser's own smooth-scroll easing fighting the
           rAF loop above. scroll-behavior: smooth (default state, right
           above) makes every scrollLeft += on a frame restart a ~300ms
           native easing animation before the previous one finishes — 60
           restarts a second reads as exactly the "truncating /
           stuttering / barely usable" auto-scroll being fixed here.
           auto makes each increment apply instantly, so the rAF loop's
           own 60fps cadence is what produces the continuous motion
           instead of fighting the browser for it. */
        .pipeline-scroll.dragging {
          scroll-snap-type: none !important;
          scroll-behavior: auto !important;
        }
        /* "Lift" — plays once when the DragOverlay mounts (a fresh drag),
           giving the card a brief, physical-feeling elevation off the
           column before it starts following the pointer. Kept local to
           this component (not globals.css) since nothing outside this
           file's JSX ever references the class name. */
        @keyframes deal-lift {
          from {
            transform: scale(1);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
          }
          to {
            transform: scale(1.03);
            box-shadow: 0 12px 24px -4px rgba(0, 0, 0, 0.35);
          }
        }
        .deal-lift {
          animation: deal-lift 180ms cubic-bezier(0.2, 0, 0, 1) forwards;
        }
      `}</style>
    </DndContext>
  );
}

function StageColumn({
  stage,
  deals,
  onEditDeal,
  onRequestDeleteDeal,
}: {
  stage: PipelineStage;
  deals: Deal[];
  // `originRect` (the clicked card's own bounding box) rides along so the
  // deal detail panel can open with a FLIP animation that visually grows
  // out of the card instead of just fading/zooming in centered.
  onEditDeal: (deal: Deal, originRect?: DOMRect) => void;
  onRequestDeleteDeal: (deal: Deal) => void;
}) {
  const t = useTranslations("Pipelines.board");
  // Fallback drop target for an empty column — SortableContext has
  // nothing to sort against with zero items, so this is what lets a
  // card be dropped into an empty stage at all.
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    // On mobile each column is `w-[85vw]` (with a reasonable min/max)
    // so the next column's edge peeks in — a "there's more here" hint.
    // snap-start lands each column cleanly when swiping. On lg+ we
    // restore the flex-1 share-the-row behavior. The droppable ref is
    // on the inner messages region below — intentionally NOT here, so
    // a drag over the column header doesn't highlight the whole column.
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
          {deals.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-lg transition-all ${
          isOver
            ? "bg-primary/5 outline outline-2 outline-dashed outline-primary outline-offset-2"
            : ""
        }`}
      >
        {deals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {t("dropDealHere")}
          </div>
        ) : (
          <SortableContext
            items={deals.map((d) => d.id)}
            strategy={verticalListSortingStrategy}
          >
            {deals.map((deal) => (
              <SortableDealCard
                key={deal.id}
                deal={deal}
                stage={stage}
                onEdit={onEditDeal}
                onRequestDelete={onRequestDeleteDeal}
              />
            ))}
          </SortableContext>
        )}
      </div>
    </div>
  );
}

function SortableDealCard({
  deal,
  stage,
  onEdit,
  onRequestDelete,
}: {
  deal: Deal;
  stage: PipelineStage;
  onEdit: (deal: Deal, originRect?: DOMRect) => void;
  onRequestDelete: (deal: Deal) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging, transform, transition } =
    useSortable({ id: deal.id });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // `pan-y` (never `none`) — the browser decides how to handle a touch
      // gesture at its very start, not reactively, so native vertical
      // scroll must stay available on the card at all times. TouchSensor's
      // delay+tolerance (above) is what actually gates the drag: a real
      // swipe never holds still long enough to arm it, so it's the browser's
      // own native scroll that wins, untouched. Horizontal panning isn't
      // granted here on purpose — swiping between columns doesn't start on
      // a card, same as real Trello.
      //
      // `transform`/`transition` come from `useSortable` — this is what
      // makes the other cards in the column glide out of the way live as
      // the dragged one moves through, no manual animation code needed.
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
        touchAction: "pan-y",
      }}
      className={
        isDragging
          ? "rounded-xl border-2 border-dashed border-primary/40 bg-primary/5"
          : undefined
      }
    >
      {/* The dragged card's own slot becomes a same-size placeholder
          (the wrapper above) with the real card hidden — `invisible`
          (not `hidden`/unmounted) so it keeps occupying exactly its
          normal layout space, which is what makes the placeholder match
          the card's real height/width without measuring anything. The
          actual moving copy the pointer follows is the DragOverlay
          instance above, not this one. */}
      <div className={isDragging ? "invisible" : undefined}>
        <DealCard deal={deal} stage={stage} onEdit={onEdit} onRequestDelete={onRequestDelete} />
      </div>
    </div>
  );
}
