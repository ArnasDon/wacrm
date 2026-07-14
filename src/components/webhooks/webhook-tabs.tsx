"use client";

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { HelpCircle, Settings, Workflow, History } from 'lucide-react';
import { WebhookOverview } from './webhook-overview';
import { WebhookConfiguration } from './webhook-configuration';
import { WebhookWorkflows } from './webhook-workflows';
import { WebhookLogs } from './webhook-logs';

export function WebhookTabs() {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="border border-border bg-muted p-1">
          <TabsTrigger
            value="overview"
            className="data-active:text-primary text-muted-foreground data-active:bg-card data-active:shadow-sm flex items-center gap-1.5 px-4 py-2"
          >
            <HelpCircle className="h-4 w-4" />
            Overview
          </TabsTrigger>
          
          <TabsTrigger
            value="configuration"
            className="data-active:text-primary text-muted-foreground data-active:bg-card data-active:shadow-sm flex items-center gap-1.5 px-4 py-2"
          >
            <Settings className="h-4 w-4" />
            Configuration
          </TabsTrigger>
          
          <TabsTrigger
            value="workflows"
            className="data-active:text-primary text-muted-foreground data-active:bg-card data-active:shadow-sm flex items-center gap-1.5 px-4 py-2"
          >
            <Workflow className="h-4 w-4" />
            Workflows
          </TabsTrigger>
          
          <TabsTrigger
            value="logs"
            className="data-active:text-primary text-muted-foreground data-active:bg-card data-active:shadow-sm flex items-center gap-1.5 px-4 py-2"
          >
            <History className="h-4 w-4" />
            Logs
          </TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="overview">
            <WebhookOverview onTabChange={setActiveTab} />
          </TabsContent>

          <TabsContent value="configuration">
            <WebhookConfiguration />
          </TabsContent>

          <TabsContent value="workflows">
            <WebhookWorkflows />
          </TabsContent>

          <TabsContent value="logs">
            <WebhookLogs />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
