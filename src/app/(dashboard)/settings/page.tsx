'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Settings, MessageSquare, Tag, User, Palette } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { TemplateManager } from '@/components/settings/template-manager';
import { TagManager } from '@/components/settings/tag-manager';
import { ProfileForm } from '@/components/settings/profile-form';
import { PasswordForm } from '@/components/settings/password-form';
import { SessionsCard } from '@/components/settings/sessions-card';
import { AppearancePanel } from '@/components/settings/appearance-panel';

const TAB_VALUES = [
  'profile',
  'whatsapp',
  'templates',
  'tags',
  'appearance',
] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(v: string | null): v is TabValue {
  return !!v && (TAB_VALUES as readonly string[]).includes(v);
}

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The URL is the single source of truth for the active tab — no
  // local state, no sync effect. A previous revision duplicated this
  // into `useState` + a sync effect, which tripped React 19's
  // set-state-in-effect rule and was also redundant.
  const queryTab = searchParams.get('tab');
  const tab: TabValue = isTabValue(queryTab) ? queryTab : 'profile';

  const onChange = (next: TabValue) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Configurações</h1>
        <p className="text-sm text-slate-400 mt-1">
          Gerencie seu perfil, integração com o WhatsApp®, modelos de mensagens e tags.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => onChange(v as TabValue)}>
        <TabsList className="bg-slate-900 border border-slate-700">
          <TabsTrigger
            value="profile"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <User className="size-4" />
            Perfil
          </TabsTrigger>
          <TabsTrigger
            value="whatsapp"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <Settings className="size-4" />
            Integração do WhatsApp
          </TabsTrigger>
          <TabsTrigger
            value="templates"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <MessageSquare className="size-4" />
            Modelos de Mensagem
          </TabsTrigger>
          <TabsTrigger
            value="tags"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <Tag className="size-4" />
            Tags
          </TabsTrigger>
          <TabsTrigger
            value="appearance"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <Palette className="size-4" />
            Aparência
          </TabsTrigger>
        </TabsList>

        <div className={tab === 'profile' ? 'space-y-6 outline-none mt-2' : 'hidden'}>
          <ProfileForm />
          <PasswordForm />
          <SessionsCard />
        </div>

        <div className={tab === 'whatsapp' ? 'outline-none mt-2' : 'hidden'}>
          <WhatsAppConfig />
        </div>

        <div className={tab === 'templates' ? 'outline-none mt-2' : 'hidden'}>
          <TemplateManager />
        </div>

        <div className={tab === 'tags' ? 'outline-none mt-2' : 'hidden'}>
          <TagManager />
        </div>

        <div className={tab === 'appearance' ? 'outline-none mt-2' : 'hidden'}>
          <AppearancePanel />
        </div>
      </Tabs>
    </div>
  );
}
