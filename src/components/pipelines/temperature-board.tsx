"use client";

// ============================================================
// TemperatureBoard — a Kanban-style view of contacts grouped by
// lead_temperature (cold / warm / hot), plus an "unclassified" column
// for contacts nobody (human or AI) has assessed yet. Visually mirrors
// PipelineBoard (same dnd-kit drag pattern, same column shell) but it
// is NOT a sales pipeline — there's no stage order or "won" state,
// just a classification. Dragging a card between columns updates
// `contacts.lead_temperature` via PATCH /api/contacts/[id], the same
// route the AI's autonomous set_temperature action and the contact
// detail panel's inline editor both already use.
// ============================================================

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
import type { Contact, LeadTemperature } from "@/types";
import { useTranslations } from "next-intl";
import { Flame, Snowflake, Sun, HelpCircle } from "lucide-react";

type ColumnKey = LeadTemperature | "unclassified";

const COLUMNS: { key: ColumnKey; color: string; icon: typeof Flame }[] = [
  { key: "unclassified", color: "#71717a", icon: HelpCircle },
  { key: "cold", color: "#3b82f6", icon: Snowflake },
  { key: "warm", color: "#f97316", icon: Sun },
  { key: "hot", color: "#ef4444", icon: Flame },
];

interface TemperatureBoardProps {
  contacts: Contact[];
  onContactMoved: (contactId: string, temperature: LeadTemperature) => void;
}

export function TemperatureBoard({ contacts, onContactMoved }: TemperatureBoardProps) {
  const [activeContactId, setActiveContactId] = useState<string | null>(null);

  const contactsByColumn = useMemo(() => {
    const map = new Map<ColumnKey, Contact[]>();
    for (const col of COLUMNS) map.set(col.key, []);
    for (const contact of contacts) {
      const key: ColumnKey = contact.lead_temperature ?? "unclassified";
      const bucket = map.get(key);
      if (bucket) bucket.push(contact);
    }
    return map;
  }, [contacts]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const activeContact = activeContactId
    ? contacts.find((c) => c.id === activeContactId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveContactId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveContactId(null);
    const { active, over } = event;
    if (!over) return;
    const contactId = String(active.id);
    const targetKey = String(over.id) as ColumnKey;
    if (targetKey === "unclassified") return; // not a settable value

    const contact = contacts.find((c) => c.id === contactId);
    if (!contact || contact.lead_temperature === targetKey) return;

    onContactMoved(contactId, targetKey);
  }

  function handleDragCancel() {
    setActiveContactId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 lg:snap-none">
        {COLUMNS.map((col) => (
          <TemperatureColumn
            key={col.key}
            columnKey={col.key}
            color={col.color}
            Icon={col.icon}
            contacts={contactsByColumn.get(col.key) ?? []}
          />
        ))}
      </div>

      <DragOverlay
        dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" }}
      >
        {activeContact ? (
          <div className="opacity-90">
            <ContactCard contact={activeContact} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function TemperatureColumn({
  columnKey,
  color,
  Icon,
  contacts,
}: {
  columnKey: ColumnKey;
  color: string;
  Icon: typeof Flame;
  contacts: Contact[];
}) {
  const t = useTranslations("Pipelines.temperature");
  const { setNodeRef, isOver } = useDroppable({ id: columnKey });

  return (
    <div className="flex w-[85vw] min-w-[240px] max-w-[300px] shrink-0 snap-start flex-col rounded-xl border border-border bg-card/60 p-4 lg:w-auto lg:max-w-none lg:flex-1 lg:basis-[240px] lg:shrink lg:snap-none">
      <div className="-mx-4 -mt-4 h-[3px] rounded-t-xl" style={{ backgroundColor: color }} />
      <div className="flex items-center justify-between pt-3">
        <h3 className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
          <Icon className="size-3.5" style={{ color }} />
          {t(columnKey)}
        </h3>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {contacts.length}
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
        {contacts.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {t("dropContactHere")}
          </div>
        ) : (
          contacts.map((contact) => <DraggableContactCard key={contact.id} contact={contact} />)
        )}
      </div>
    </div>
  );
}

function DraggableContactCard({ contact }: { contact: Contact }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: contact.id });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: "none" }}
    >
      <ContactCard contact={contact} />
    </div>
  );
}

function ContactCard({ contact }: { contact: Contact }) {
  const t = useTranslations("Pipelines.temperature");
  return (
    <div className="cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm active:cursor-grabbing">
      <p className="truncate text-sm font-medium text-foreground">
        {contact.name || contact.phone || contact.instagram_username || t("noName")}
      </p>
      {contact.phone && (
        <p className="truncate text-xs text-muted-foreground">{contact.phone}</p>
      )}
    </div>
  );
}
