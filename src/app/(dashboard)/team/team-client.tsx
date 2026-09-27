'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { loadTeamPerformance } from '@/lib/dashboard/queries';
import type { AgentPerformance } from '@/lib/dashboard/types';
import { SkeletonCard } from '@/components/dashboard/skeleton';

export function TeamDashboardClient() {
  const [performance, setPerformance] = useState<AgentPerformance[] | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(() => {
    const db = createClient();
    loadTeamPerformance(db, 30)
      .then((data) => setPerformance(data))
      .catch((err) => console.error('[team-dashboard] failed:', err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  return (
    <div className="space-y-5 pb-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold">Team Performance</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Monitor response times, leads worked, and conversion rates across your
          team.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {loading || !performance
          ? Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
          : performance.map((agent) => (
              <Card key={agent.agentId} className="flex flex-col">
                <CardHeader className="flex flex-row items-center gap-3 pb-2">
                  <Avatar className="size-10">
                    <AvatarImage src={agent.avatarUrl ?? undefined} />
                    <AvatarFallback>
                      {agent.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <CardTitle className="text-base">{agent.name}</CardTitle>
                    <p className="text-muted-foreground text-xs tracking-wider uppercase">
                      {agent.role}
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 pt-4">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
                    <div>
                      <dt className="text-muted-foreground text-xs font-medium">
                        Avg Response Time
                      </dt>
                      <dd className="text-foreground mt-1 text-lg font-semibold">
                        {agent.avgResponseTimeMin !== null
                          ? `${Math.round(agent.avgResponseTimeMin)} min`
                          : '--'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs font-medium">
                        Leads Worked
                      </dt>
                      <dd className="text-foreground mt-1 text-lg font-semibold">
                        {agent.leadsWorked}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs font-medium">
                        Visits / No-Show
                      </dt>
                      <dd className="text-foreground mt-1 text-lg font-semibold">
                        {agent.visitsCompleted}{' '}
                        <span className="text-muted-foreground text-sm font-normal">
                          (
                          {agent.noShowRate !== null
                            ? Math.round(agent.noShowRate)
                            : 0}
                          %)
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs font-medium">
                        Conversion Rate
                      </dt>
                      <dd className="text-foreground mt-1 text-lg font-semibold">
                        {agent.conversionRate !== null
                          ? `${Math.round(agent.conversionRate)}%`
                          : '--'}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            ))}
      </div>
    </div>
  );
}
