'use client';

// Small reusable editor for the products table's five string[]/JSONB
// array summary fields (key_features, benefits, vehicle_types,
// recommended_vehicles, engine_types) — free-form bullet lists that,
// per migration 041's own reasoning, don't warrant their own child
// tables. Used nowhere else yet; kept feature-scoped under
// components/products rather than components/ui, matching the
// content/localization-panel.tsx precedent for feature-specific pieces.

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface TagListEditorProps {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function TagListEditor({
  label,
  items,
  onChange,
  disabled = false,
  placeholder,
}: TagListEditorProps) {
  const [draft, setDraft] = useState('');

  function add() {
    const value = draft.trim();
    if (!value || items.includes(value)) {
      setDraft('');
      return;
    }
    onChange([...items, value]);
    setDraft('');
  }

  function remove(item: string) {
    onChange(items.filter((i) => i !== item));
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <Badge key={item} variant="outline" className="gap-1 pr-1">
              {item}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${item}`}
                  onClick={() => remove(item)}
                  className="text-muted-foreground hover:text-destructive rounded-full"
                >
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
      {!disabled && (
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
          />
          <Button type="button" variant="outline" size="icon" onClick={add}>
            <Plus className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
