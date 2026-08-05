'use client';

import { Phone, Headset, Settings2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { VoicePanel } from '@/components/voice/voice-panel';
import { TelnyxConfig } from '@/components/settings/telnyx-config';

type Tab = 'softphone' | 'setup';

export default function CallsPage() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Phone className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Phone
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Make and receive calls over Telnyx — softphone, call history, and
        Telnyx configuration.
      </p>

      <Tabs defaultValue="softphone" className="mt-6">
        <TabsList>
          <TabsTrigger value="softphone">
            <Headset className="mr-1.5 h-4 w-4" /> Softphone
          </TabsTrigger>
          <TabsTrigger value="setup">
            <Settings2 className="mr-1.5 h-4 w-4" /> Setup
          </TabsTrigger>
        </TabsList>

        <TabsContent value="softphone" className="mt-4">
          <div className="flex h-[560px] flex-col overflow-hidden rounded-xl border bg-card">
            <VoicePanel />
          </div>
        </TabsContent>

        <TabsContent value="setup" className="mt-4">
          <TelnyxConfig />
        </TabsContent>
      </Tabs>
    </div>
  );
}
