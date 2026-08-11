'use client';

import { Suspense, useState } from 'react';
import { Mail, Settings2, FileText, Megaphone, Plus } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmailConfig } from '@/components/settings/email-config';
import { EmailTemplatesManager } from '@/components/settings/email-templates-manager';
import { EmailCampaignsList } from '@/components/email/email-campaigns-list';
import { GatedButton } from '@/components/ui/gated-button';
import { useCan } from '@/hooks/use-can';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

type Tab = 'campaigns' | 'templates' | 'setup';

const VALID_TABS: readonly Tab[] = ['campaigns', 'templates', 'setup'];

// `useSearchParams` opts this page out of static prerendering unless it
// sits under a Suspense boundary. Without one, the production build hits
// the "missing Suspense with CSR bailout" error and the whole page bails
// to client-side rendering — the same bug already fixed in settings
// (settings/page.tsx). Mirror that pattern: a thin wrapper supplies the
// boundary; the inner component reads the query string.
export default function EmailPage() {
  return (
    <Suspense fallback={null}>
      <EmailPageInner />
    </Suspense>
  );
}

function EmailPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('EmailCampaigns.page');
  const canCreate = useCan('send-messages');
  const tabParam = searchParams.get('tab') as Tab | null;
  const urlTab: Tab =
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'campaigns';

  // `<Tabs value>` sin `onValueChange` es un componente CONTROLADO que nunca
  // cambia: pulsar Templates o Setup no hacía absolutamente nada, así que las
  // dos pestañas eran inalcanzables y no había forma de llegar al gestor de
  // plantillas ni de guardar la API key de Resend.
  //
  // Mismo patrón que /agents: el valor lo lleva estado local. El `?tab=` se
  // sigue leyendo al entrar, para que los enlaces profundos funcionen; no se
  // reescribe en cada clic, que obligaría a navegar por cambiar de pestaña.
  const [activeTab, setActiveTab] = useState<Tab>(urlTab);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        </div>

        {/* La acción principal vive en la cabecera de la página, como en
            /broadcasts. Antes solo existía dentro del panel de campañas,
            debajo de un segundo título repetido. */}
        {activeTab === 'campaigns' && (
          <GatedButton
            canAct={canCreate}
            gateReason="create email campaigns"
            onClick={() => router.push('/email/new')}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t('newCampaign')}
          </GatedButton>
        )}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as Tab)}
        className="mt-6"
      >
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