import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { format, formatDistance } from 'date-fns';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../messages/pt.json';
import { getDateLocale } from './date-locale';
import type { Translate } from '@/lib/i18n/translate';
import { presenceLabel } from '@/lib/presence';
import { buildHandoffSummary } from '@/lib/ai/handoff';
import { notificationText } from '@/lib/notifications/notification-text';
import { ModeToggle } from '@/components/layout/mode-toggle';
import { AppearancePanel } from '@/components/settings/appearance-panel';

const themeState = vi.hoisted(() => ({ mode: 'dark', theme: 'violet' }));
vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({
    ...themeState,
    setMode: vi.fn(),
    setTheme: vi.fn(),
    toggleMode: vi.fn(),
  }),
}));

function translator(namespace: string): Translate {
  return createTranslator({
    locale: 'pt',
    messages,
    namespace: namespace as never,
    onError: (error) => {
      throw error;
    },
  }) as unknown as Translate;
}

describe('Portuguese messages in their UI context', () => {
  it.each([
    [0, '0 clientes aguardam resposta; o maior tempo de espera é de 5 min.'],
    [1, '1 cliente aguarda resposta há 5 min.'],
    [3, '3 clientes aguardam resposta; o maior tempo de espera é de 5 min.'],
  ])(
    'renders the waiting summary for %i without leaking ICU syntax',
    (count, expected) => {
      const t = translator('Dashboard.overview.header');
      const text = t('contextWaiting', { count, wait: '5 min' });
      expect(text).toBe(expected);
      expect(text).not.toMatch(/other|plural|[{}#]/);
    }
  );

  it.each([
    ['rowsReady', '1 linha pronta', '2 linhas prontas'],
    ['moreRows', '+ 1 linha não exibida', '+ 2 linhas não exibidas'],
    ['resultTags', '1 tag atribuída', '2 tags atribuídas'],
    ['resultInvalidPhone', '1 telefone inválido', '2 telefones inválidos'],
    ['importBtn', 'Importar 1 contato', 'Importar 2 contatos'],
    ['toastImported', '1 contato importado', '2 contatos importados'],
    [
      'toastTagsAssigned',
      '1 atribuição de tag aplicada',
      '2 atribuições de tag aplicadas',
    ],
    ['toastSkipped', '1 duplicado ignorado', '2 duplicados ignorados'],
    [
      'toastInvalidPhone',
      '1 contato não tinha um número de telefone utilizável',
      '2 contatos não tinham um número de telefone utilizável',
    ],
    [
      'toastFailed',
      '1 contato não pôde ser importado',
      '2 contatos não puderam ser importados',
    ],
  ])(
    'pluralizes the base import key %s used by the component',
    (key, singular, plural) => {
      const t = translator('Contacts.importModal');
      expect(t(key, { count: 1 })).toBe(singular);
      expect(t(key, { count: 2 })).toBe(plural);
    }
  );

  it('pluralizes tags and contacts independently, including zero', () => {
    const t = translator('Contacts.importModal');
    expect(t('previewTags', { tags: 1, contacts: 2 })).toBe(
      '1 tag · 2 contatos'
    );
    expect(t('previewTags', { tags: 2, contacts: 1 })).toBe(
      '2 tags · 1 contato'
    );
    expect(t('previewTags', { tags: 0, contacts: 0 })).toBe(
      '0 tags · 0 contatos'
    );
    expect(t('importBtn', { count: 0 })).toBe('Importar 0 contatos');
  });

  it.each([
    ['dark', 'claro'],
    ['light', 'escuro'],
  ])(
    'describes the destination of the %s mode toggle in Portuguese',
    (mode, target) => {
      themeState.mode = mode;
      const html = renderToStaticMarkup(
        <NextIntlClientProvider locale="pt" messages={messages} timeZone="UTC">
          <ModeToggle />
        </NextIntlClientProvider>
      );
      expect(html).toContain(`aria-label="Mudar para o modo ${target}"`);
    }
  );

  it('renders localized theme names, descriptions and accessible mode labels', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="pt" messages={messages} timeZone="UTC">
        <AppearancePanel />
      </NextIntlClientProvider>
    );
    expect(html).toContain('aria-label="Usar o modo claro"');
    expect(html).toContain('aria-label="Usar o modo escuro"');
    expect(html).toContain('Usar o tema Azul-cobalto');
    expect(html).toContain(
      'O padrão — transmite confiança com um toque descontraído.'
    );
    expect(html).not.toMatch(/Growth-coded|product-y|Use light|Use dark/);
  });

  it('formats month names and durations in Brazilian Portuguese', () => {
    const locale = getDateLocale('pt');
    const start = new Date(2026, 9, 18, 12, 0);
    const end = new Date(2026, 9, 18, 12, 5);
    expect(format(start, 'PPP', { locale })).toBe('18 de outubro de 2026');
    expect(formatDistance(end, start, { locale })).toBe('5 minutos');
  });

  it('localizes presence tooltips and their interpolated time', () => {
    const now = new Date('2026-10-18T12:00:00Z').getTime();
    const t = translator('Presence');
    expect(presenceLabel('online', null, now, t)).toBe('Online — ativo agora');
    expect(presenceLabel('away', null, now, t)).toBe('Ausente — sem atividade');
    expect(presenceLabel('offline', '2026-10-18T10:00:00Z', now, t)).toBe(
      'Offline — última atividade há 2 horas'
    );
    expect(presenceLabel('offline', null, now, t)).toBe(
      'Offline — última atividade há algum tempo'
    );
  });

  it.each([
    [0, 'sem responder'],
    [1, 'após 1 resposta'],
    [2, 'após 2 respostas'],
  ])(
    'localizes the handoff note after %i replies without translating customer content',
    (replyCount, phrase) => {
      expect(
        buildHandoffSummary(
          {
            replyCount,
            messages: [{ role: 'user', content: 'help {please}' }],
          },
          translator('Handoff')
        )
      ).toBe(
        `🤖 O agente de IA transferiu a conversa ${phrase}. Última mensagem do cliente: “help {please}”`
      );
    }
  );

  it('localizes stored assignment notifications from structured references', () => {
    const notification = {
      type: 'conversation_assigned' as const,
      title: 'New conversation assigned',
      body: 'Original English body',
    };
    const t = translator('Notifications');
    expect(
      notificationText(notification, { actor: 'John', contact: 'Acme' }, t)
    ).toEqual({
      title: 'Nova conversa atribuída',
      body: 'John atribuiu a você uma conversa com Acme',
    });
    expect(notificationText(notification, {}, t).body).toBe(
      'Alguém atribuiu a você uma conversa com um contato'
    );
    expect(notification.body).toBe('Original English body');
  });
});
