import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createTranslator, type AbstractIntlMessages } from 'next-intl';
import { describe, expect, it } from 'vitest';

const messagesDirectory = join(process.cwd(), 'messages');
const tagWithAttributes = /<[A-Za-z][\w:-]*\s+[^>]*>/;
const templateLiteralKeys = [
  'headerTextPlaceholder',
  'headerSamplePlaceholder',
  'bodyPlaceholder',
  'bodyHint',
  'urlPlaceholder',
  'urlSamplePlaceholder',
] as const;

function collectStrings(
  value: unknown,
  path: string[] = []
): Array<{ path: string; value: string }> {
  if (typeof value === 'string') {
    return [{ path: path.join('.'), value }];
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    collectStrings(child, [...path, key])
  );
}

async function loadLocale(fileName: string): Promise<AbstractIntlMessages> {
  const contents = await readFile(join(messagesDirectory, fileName), 'utf8');
  return JSON.parse(contents) as AbstractIntlMessages;
}

describe('locale message contracts', () => {
  it.each(['en.json', 'ko.json'])(
    'defines the Flows title used by the shared header in %s',
    async (fileName) => {
      const messages = await loadLocale(fileName);

      expect(messages.Header).toMatchObject({
        flows: expect.any(String),
      });
    }
  );

  it('does not put attributes on ICU rich-text tags', async () => {
    const localeFiles = (await readdir(messagesDirectory)).filter((file) =>
      file.endsWith('.json')
    );
    const invalidMessages: string[] = [];

    for (const fileName of localeFiles) {
      const messages = await loadLocale(fileName);
      for (const message of collectStrings(messages)) {
        if (tagWithAttributes.test(message.value)) {
          invalidMessages.push(`${fileName}:${message.path}`);
        }
      }
    }

    expect(invalidMessages).toEqual([]);
  });

  it.each(['en.json', 'ko.json'])(
    'renders template variable examples literally in %s',
    async (fileName) => {
      const locale = fileName.replace('.json', '');
      const messages = await loadLocale(fileName);
      const translate = createTranslator({
        locale,
        messages,
      }) as unknown as (key: string) => string;

      for (const key of templateLiteralKeys) {
        const rendered = translate(`Settings.templates.${key}`);
        expect(rendered).not.toMatch(/^Settings\./);
        expect(rendered).toContain('{{1}}');
      }

      expect(translate('Settings.templates.bodyPlaceholder')).toContain(
        '{{2}}'
      );
      expect(translate('Settings.templates.bodyHint')).toContain('{{2}}');
    }
  );
});
