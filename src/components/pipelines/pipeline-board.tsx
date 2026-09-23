import { useMemo, useState } from 'react';
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
} from '@dnd-kit/core';
import type { Deal, PipelineStage } from '@/types';
import { DealCard } from './deal-card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

interface PipelineBoardProps {
  stages: PipelineStage[];
  deals: Deal[];
  onDealMoved: (dealId: string, newStageId: string) => void;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
}

export function PipelineBoard({
  stages,
  deals,
  onDealMoved,
  onAddDeal,
  onEditDeal,
}: PipelineBoardProps) {
  const { defaultCurrency } = useAuth();
  const t = useTranslations('Pipelines.board');
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  const [moveDealId, setMoveDealId] = useState<string | null>(null);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages]
  );

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of sortedStages) map.set(stage.id, []);
    for (const deal of deals) {
      const bucket = map.get(deal.stage_id);
      if (bucket) bucket.push(deal);
    }
    return map;
  }, [sortedStages, deals]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const activeDeal = activeDealId
    ? (deals.find((d) => d.id === activeDealId) ?? null)
    : null;
    
  const moveDeal = moveDealId ? deals.find(d => d.id === moveDealId) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveDealId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDealId(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    const targetStageId = String(over.id);

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === targetStageId) return;
    if (!sortedStages.some((s) => s.id === targetStageId)) return;

    onDealMoved(dealId, targetStageId);
  }

  function handleDragCancel() {
    setActiveDealId(null);
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* Desktop View (DndContext needs to wrap the layout) */}
        <div className="hidden lg:flex pipeline-scroll snap-none gap-3 overflow-x-auto pb-4">
          {sortedStages.map((stage) => {
            const stageDeals = dealsByStage.get(stage.id) ?? [];
            const totalValue = stageDeals.reduce(
              (s, d) => s + Number(d.value || 0),
              0
            );
            return (
              <StageColumn
                key={stage.id}
                stage={stage}
                deals={stageDeals}
                totalValue={totalValue}
                currency={defaultCurrency}
                onAddDeal={onAddDeal}
                onEditDeal={onEditDeal}
                onMoveDeal={(d) => setMoveDealId(d.id)}
              />
            );
          })}
        </div>
        
        {/* Mobile Tabs View */}
        <div className="lg:hidden">
          <Tabs defaultValue={sortedStages[0]?.id}>
            <TabsList className="w-full flex h-auto overflow-x-auto [&::-webkit-scrollbar]:hidden snap-x snap-mandatory bg-transparent border-b border-border rounded-none p-0" style={{ scrollbarWidth: 'none' }}>
              {sortedStages.map((s) => (
                <TabsTrigger
                  key={s.id}
                  value={s.id}
                  className="snap-start shrink-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 text-sm font-medium transition-none"
                >
                  {s.name}
                  <span className="ml-2 bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px]">
                    {dealsByStage.get(s.id)?.length || 0}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
            
            {sortedStages.map((stage) => {
              const stageDeals = dealsByStage.get(stage.id) ?? [];
              const totalValue = stageDeals.reduce(
                (s, d) => s + Number(d.value || 0),
                0
              );
              return (
                <TabsContent key={stage.id} value={stage.id} className="pt-4 space-y-3 outline-none">
                  <div className="flex items-center justify-between">
                    <p className="text-muted-foreground text-xs font-medium">
                      {t('totalValue')}: {formatCurrency(totalValue, defaultCurrency)}
                    </p>
                  </div>
                  
                  {stageDeals.length === 0 ? (
                    <div className="border-border text-muted-foreground flex items-center justify-center rounded-lg border-2 border-dashed py-10 text-xs">
                      {t('dropDealHere')}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {stageDeals.map((deal) => (
                        <DealCard
                          key={deal.id}
                          deal={deal}
                          stage={stage}
                          onEdit={onEditDeal}
                          onMove={() => setMoveDealId(deal.id)}
                        />
                      ))}
                    </div>
                  )}
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onAddDeal(stage.id)}
                    className="border-border text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground mt-3 w-full justify-start border border-dashed bg-transparent"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    {t('addDeal')}
                  </Button>
                </TabsContent>
              );
            })}
          </Tabs>
        </div>

        <DragOverlay
          dropAnimation={{
            duration: 200,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
          }}
        >
          {activeDeal ? (
            <div className="opacity-90">
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
      </DndContext>

      <Sheet open={!!moveDealId} onOpenChange={(open) => !open && setMoveDealId(null)}>
        <SheetContent side="bottom" className="bg-popover border-t border-border rounded-t-xl sm:max-w-md sm:mx-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-left">{t('moveToStage')}</SheetTitle>
          </SheetHeader>
          <div className="space-y-2">
            {sortedStages.map(stage => {
              const isActive = moveDeal?.stage_id === stage.id;
              return (
                <button
                  key={stage.id}
                  onClick={() => {
                    if (!isActive && moveDealId) {
                      onDealMoved(moveDealId, stage.id);
                    }
                    setMoveDealId(null);
                  }}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors ${
                    isActive 
                      ? 'bg-primary/10 border-primary/20 text-primary cursor-default' 
                      : 'bg-card border-border hover:bg-muted text-foreground'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="size-3 rounded-full shrink-0"
                      style={{ backgroundColor: stage.color }}
                    />
                    <span className="font-medium text-sm">{stage.name}</span>
                  </div>
                  {isActive && <span className="text-xs font-semibold">{t('currentStage')}</span>}
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

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
      `}</style>
    </>
  );
}

function StageColumn({
  stage,
  deals,
  totalValue,
  currency,
  onAddDeal,
  onEditDeal,
  onMoveDeal,
}: {
  stage: PipelineStage;
  deals: Deal[];
  totalValue: number;
  currency: string;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  onMoveDeal: (deal: Deal) => void;
}) {
  const t = useTranslations('Pipelines.board');
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    // On mobile each column is `w-[85vw]` (with a reasonable min/max)
    // so the next column's edge peeks in — a "there's more here" hint.
    // snap-start lands each column cleanly when swiping. On lg+ we
    // restore the flex-1 share-the-row behavior. The droppable ref is
    // on the inner messages region below — intentionally NOT here, so
    // a drag over the column header doesn't highlight the whole column.
    <div className="border-border bg-card/60 flex w-[85vw] max-w-[320px] min-w-[260px] shrink-0 snap-start flex-col rounded-xl border p-4 lg:w-auto lg:max-w-none lg:flex-1 lg:shrink lg:basis-[260px] lg:snap-none">
      {/* 3px colored top border — sits above the column's padding */}
      <div
        className="-mx-4 -mt-4 h-[3px] rounded-t-xl"
        style={{ backgroundColor: stage.color }}
      />
      <div className="flex items-center justify-between pt-3">
        <h3 className="text-foreground truncate text-sm font-semibold">
          {stage.name}
        </h3>
        <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
          {deals.length}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        {formatCurrency(totalValue, currency)}
      </p>

      <div
        ref={setNodeRef}
        className={`mt-3 flex flex-1 flex-col gap-2 rounded-lg transition-all ${
          isOver
            ? 'bg-primary/5 outline-primary outline outline-2 outline-offset-2 outline-dashed'
            : ''
        }`}
      >
        {deals.length === 0 ? (
          <div className="border-border text-muted-foreground flex flex-1 items-center justify-center rounded-lg border-2 border-dashed py-10 text-xs">
            {t('dropDealHere')}
          </div>
        ) : (
          deals.map((deal) => (
            <DraggableDealCard
              key={deal.id}
              deal={deal}
              stage={stage}
              onEdit={onEditDeal}
              onMove={onMoveDeal}
            />
          ))
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onAddDeal(stage.id)}
        className="border-border text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground mt-3 w-full justify-start border border-dashed bg-transparent"
      >
        <Plus className="mr-1 h-3 w-3" />
        {t('addDeal')}
      </Button>
    </div>
  );
}

function DraggableDealCard({
  deal,
  stage,
  onEdit,
  onMove,
}: {
  deal: Deal;
  stage: PipelineStage;
  onEdit: (deal: Deal) => void;
  onMove: (deal: Deal) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: 'none' }}
    >
      <DealCard deal={deal} stage={stage} onEdit={onEdit} onMove={onMove} />
    </div>
  );
}
