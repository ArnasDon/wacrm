'use client';

import { Settings2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CalcProjectWithComponents } from '@/lib/calculator/queries';

interface ProjectPickerProps {
  mode: 'free' | 'project';
  onModeChange: (mode: 'free' | 'project') => void;
  projects: CalcProjectWithComponents[];
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onManageProjects: () => void;
  freeFlowLabel: string;
  projectsLabel: string;
  manageLabel: string;
  noProjectsLabel: string;
}

export function ProjectPicker({
  mode,
  onModeChange,
  projects,
  selectedProjectId,
  onSelectProject,
  onManageProjects,
  freeFlowLabel,
  projectsLabel,
  manageLabel,
  noProjectsLabel,
}: ProjectPickerProps) {
  return (
    <div className="flex flex-col gap-3">
      <Tabs value={mode} onValueChange={(v) => onModeChange(v as 'free' | 'project')}>
        <TabsList>
          <TabsTrigger value="free">{freeFlowLabel}</TabsTrigger>
          <TabsTrigger value="project">{projectsLabel}</TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === 'project' && (
        <div className="flex flex-wrap items-center gap-2">
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">{noProjectsLabel}</p>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onSelectProject(project.id)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  selectedProjectId === project.id
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {project.name}
              </button>
            ))
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onManageProjects}>
            <Settings2 className="size-3.5" />
            {manageLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
