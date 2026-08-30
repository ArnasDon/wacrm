"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconChevronDown,
  IconDeviceFloppy,
  IconPencil,
  IconRefresh,
  IconTrash,
  IconUsers,
  IconUsersGroup,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SavedView } from "@/lib/saved-views/types";

interface ViewsBarProps {
  views: SavedView[];
  activeViewId: string | null;
  /** current state differs from the active view's saved config */
  dirty: boolean;
  onSelectAll: () => void;
  onSelectView: (view: SavedView) => void;
  onCreate: (name: string) => void | Promise<unknown>;
  onUpdateActive: () => void | Promise<unknown>;
  onRename: (view: SavedView, name: string) => void | Promise<unknown>;
  onToggleShared: (view: SavedView) => void | Promise<unknown>;
  onDelete: (view: SavedView) => void | Promise<unknown>;
}

function NamePopover({
  trigger,
  initial = "",
  submitLabel,
  onSubmit,
}: {
  trigger: React.ReactNode;
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initial);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setValue(initial);
      }}
    >
      <PopoverTrigger render={trigger as React.ReactElement} />
      <PopoverContent align="start" className="w-60 p-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = value.trim();
            if (!name) return;
            onSubmit(name);
            setOpen(false);
          }}
          className="flex flex-col gap-2"
        >
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={60}
            placeholder="Nombre de la vista"
          />
          <Button type="submit" size="sm" disabled={!value.trim()}>
            {submitLabel}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function ViewsBar({
  views,
  activeViewId,
  dirty,
  onSelectAll,
  onSelectView,
  onCreate,
  onUpdateActive,
  onRename,
  onToggleShared,
  onDelete,
}: ViewsBarProps) {
  const t = useTranslations("Contacts.views");

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border pb-2">
      <button
        type="button"
        onClick={onSelectAll}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
          activeViewId === null
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <IconUsers className="size-4" />
        {t("all")}
      </button>

      {views.map((view) => {
        const active = view.id === activeViewId;
        return (
          <div
            key={view.id}
            className={cn(
              "flex shrink-0 items-center rounded-md pr-1 text-sm font-medium transition-colors",
              active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <button
              type="button"
              onClick={() => onSelectView(view)}
              className="flex items-center gap-1.5 py-1.5 pl-2.5"
            >
              {view.is_shared ? <IconUsersGroup className="size-4" /> : null}
              <span className="max-w-[10rem] truncate">{view.name}</span>
              {active && dirty ? (
                <span
                  className="ml-0.5 size-1.5 rounded-full bg-primary"
                  title={t("unsavedChanges")}
                />
              ) : null}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t("viewOptions")}
                className="flex size-5 items-center justify-center rounded hover:bg-background/60"
              >
                <IconChevronDown className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-48">
                {active && dirty ? (
                  <>
                    <DropdownMenuItem onClick={() => void onUpdateActive()}>
                      <IconRefresh className="size-4" />
                      {t("updateWithCurrent")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <NamePopover
                  initial={view.name}
                  submitLabel={t("save")}
                  onSubmit={(name) => void onRename(view, name)}
                  trigger={
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                      <IconPencil className="size-4" />
                      {t("rename")}
                    </DropdownMenuItem>
                  }
                />
                <DropdownMenuItem onClick={() => void onToggleShared(view)}>
                  <IconUsersGroup className="size-4" />
                  {view.is_shared ? t("unshare") : t("share")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => void onDelete(view)}
                  className="text-destructive focus:text-destructive"
                >
                  <IconTrash className="size-4" />
                  {t("delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}

      <NamePopover
        submitLabel={t("save")}
        onSubmit={(name) => void onCreate(name)}
        trigger={
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5 text-muted-foreground"
          >
            <IconDeviceFloppy className="size-4" />
            {t("saveView")}
          </Button>
        }
      />
    </div>
  );
}
