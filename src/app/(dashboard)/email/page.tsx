'use client';

import { Mail, Settings2, FileText, Megaphone } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmailConfig } from '@/components/settings/email-config';
import { EmailTemplatesManager } from '@/components/settings/email-templates-manager';
import { EmailCampaignsList } from '@/components/email/email-campaigns-list';
import { useSearchParams } from 'next/navigation';

type Tab = 'campaigns' | 'templates' | 'setup';

const VALID_TABS: readonly Tab[] = ['campaigns', 'templates', 'setup'];

export default function EmailPage() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab') as Tab | null;
  const activeTab: Tab =
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'campaigns';

  return (
    <div>
      <div className="flex items-center gap-2">
        <Mail className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Email
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Send transactional email and run campaigns with Resend.
      </p>

      <Tabs value={activeTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="campaigns">
            <Megaphone className="mr-1.5 h-4 w-4" /> Campaigns
          </TabsTrigger>
          <TabsTrigger value="templates">
            <FileText className="mr-1.5 h-4 w-4" /> Templates
          </TabsTrigger>
          <TabsTrigger value="setup">
            <Settings2 className="mr-1.5 h-4 w-4" /> Setup
          </TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="mt-4">
          <EmailCampaignsList />
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <EmailTemplatesManager />
        </TabsContent>

        <TabsContent value="setup" className="mt-4">
          <EmailConfig />
        </TabsContent>
      </Tabs>
    </div>
  );
}