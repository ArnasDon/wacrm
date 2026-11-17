import { createTranslator } from 'next-intl';
import { format, formatDistance } from 'date-fns';
import { describe, expect, it } from 'vitest';
import messages from '../../messages/es.json';
import { getDateLocale } from './date-locale';
import type { Translate } from '@/lib/i18n/translate';
import { presenceLabel } from '@/lib/presence';
import { buildHandoffSummary } from '@/lib/ai/handoff';
import { notificationText } from '@/lib/notifications/notification-text';

function translator(namespace: string): Translate {
  return createTranslator({
    locale: 'es',
    messages,
    namespace: namespace as never,
    onError: (error) => {
      throw error;
    },
  }) as unknown as Translate;
}

describe('Spanish messages in their UI context', () => {
  it('localizes theme names and mode labels', () => {
    const t = translator('Settings.appearance');
    expect(t('useMode', { mode: t('modes.light') })).toContain('claro');
    expect(t('useMode', { mode: t('modes.dark') })).toContain('oscuro');
    expect(t('themes.cobalt.name')).toBe('Azul cobalto');
  });

  it('formats dates and elapsed durations in Spanish', () => {
    const locale = getDateLocale('es');
    const start = new Date(2026, 9, 18, 12, 0);
    expect(format(start, 'PPP', { locale })).toBe('18 de octubre de 2026');
    expect(
      formatDistance(new Date(2026, 9, 18, 12, 5), start, { locale })
    ).toBe('5 minutos');
  });

  it('renders presence and its relative time in Spanish', () => {
    const now = new Date('2026-10-18T12:00:00Z').getTime();
    const t = translator('Presence');
    expect(presenceLabel('online', null, now, t)).toBe(
      'En línea — activo ahora'
    );
    expect(presenceLabel('offline', '2026-10-18T10:00:00Z', now, t)).toBe(
      'Sin conexión — última actividad hace 2 horas'
    );
    expect(t('minutesAgo', { count: 1 })).toBe('hace 1 minuto');
  });

  it.each([
    [0, 'sin responder'],
    [1, 'después de 1 respuesta'],
    [2, 'después de 2 respuestas'],
  ])(
    'renders a handoff after %i replies without exposing ICU syntax',
    (replyCount, phrase) => {
      const text = buildHandoffSummary(
        {
          replyCount: Number(replyCount),
          messages: [{ role: 'user', content: 'help {please}' }],
        },
        translator('Handoff')
      );
      expect(text).toBe(
        `🤖 El agente de IA transfirió la conversación ${phrase}. Último mensaje del cliente: “help {please}”`
      );
      expect(text).not.toMatch(/other|plural|#/);
    }
  );

  it('localizes assignment notifications without changing stored content', () => {
    const original = {
      type: 'conversation_assigned' as const,
      title: 'New conversation assigned',
      body: 'Original English body',
    };
    const t = translator('Notifications');
    expect(
      notificationText(original, { actor: 'Ana', contact: 'Acme' }, t)
    ).toEqual({
      title: 'Nueva conversación asignada',
      body: 'Ana te asignó una conversación con Acme',
    });
    expect(notificationText(original, {}, t).body).toBe(
      'Alguien te asignó una conversación con un contacto'
    );
    expect(original.body).toBe('Original English body');
  });
});
