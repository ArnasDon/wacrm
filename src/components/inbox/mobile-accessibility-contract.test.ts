import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function hasTokenSet(fileSource: string, tokens: string[]): boolean {
  const stringLiterals = [
    ...fileSource.matchAll(/"([^"\r\n]*)"|'([^'\r\n]*)'/g),
  ].map((match) => match[1] ?? match[2]);

  return stringLiterals.some((literal) => {
    const present = new Set(literal.trim().split(/\s+/));
    return tokens.every((token) => present.has(token));
  });
}

describe('mobile inbox structure', () => {
  it('contains the page, list, viewport, and conversation rows horizontally', () => {
    const page = source('../../app/(dashboard)/inbox/page.tsx');
    const list = source('./conversation-list.tsx');

    expect(hasTokenSet(page, ['min-w-0', 'max-w-[100vw]'])).toBe(true);
    expect(
      hasTokenSet(page, [
        'flex',
        'min-w-0',
        'max-w-full',
        'flex-1',
        'overflow-hidden',
      ])
    ).toBe(true);
    expect(
      hasTokenSet(list, [
        'w-full',
        'min-w-0',
        'max-w-full',
        'flex-col',
        'overflow-hidden',
      ])
    ).toBe(true);
    expect(list).toContain(
      '[&_[data-slot=scroll-area-viewport]]:!overflow-x-hidden'
    );
    expect(
      hasTokenSet(list, [
        'w-full',
        'min-w-0',
        'max-w-full',
        'items-start',
        'gap-3',
        'overflow-hidden',
      ])
    ).toBe(true);
  });

  it('renders contact details in a controlled mobile Sheet and a desktop panel', () => {
    const page = source('../../app/(dashboard)/inbox/page.tsx');
    const thread = source('./message-thread.tsx');

    expect(page).toMatch(/open=\{mobileContactPanelOpen\}/);
    expect(page).toMatch(/className=["']hidden lg:block["']/);
    expect(page).toMatch(/variant=["']sheet["']/);
    expect(page).toMatch(
      /onOpenContactPanel=\{\(\) => setMobileContactPanelOpen\(true\)\}/
    );
    expect(thread).toMatch(/aria-label=\{t\(["']showContactPanel["']\)\}/);
    expect(thread).toContain('lg:hidden');
  });
});

describe('inbox and contact action accessibility', () => {
  it('gives icon-only inbox controls action names and tooltip text', () => {
    const thread = source('./message-thread.tsx');
    const composer = source('./message-composer.tsx');
    const actions = source('./message-actions.tsx');
    const reactions = source('./message-reactions.tsx');
    const reply = source('./reply-quote.tsx');

    expect(thread).toMatch(/aria-label=\{t\(["']assign["']\)\}/);
    expect(thread).toContain('<TooltipContent>');
    expect(composer).toMatch(/aria-label=\{t\(["']attachMedia["']\)\}/);
    expect(composer).toMatch(/aria-label=\{t\(["']moreActions["']\)\}/);
    expect(composer).toMatch(/aria-label=\{t\(["']sendTemplate["']\)\}/);
    expect(composer).toMatch(/aria-label=\{t\(["']send["']\)\}/);
    expect(actions).toMatch(/title=\{t\(["']react["']\)\}/);
    expect(actions).toMatch(/title=\{t\(["']reply["']\)\}/);
    expect(actions).toMatch(/title=\{t\(["']copyText["']\)\}/);
    expect(reactions).toMatch(/aria-label=\{t\(["']reactWith["']/);
    expect(reply).toMatch(/title=\{t\(["']cancelReply["']\)\}/);
  });

  it('names contact actions and distinguishes the contact empty state', () => {
    const sidebar = source('./contact-sidebar.tsx');
    const customFields = source('../contacts/custom-fields-manager.tsx');
    const contactsPage = source('../../app/(dashboard)/contacts/page.tsx');

    expect(sidebar).toMatch(/tSidebar\(["']copyPhone["']\)/);
    expect(sidebar).toMatch(/aria-label=\{tSidebar\(["']addNote["']\)\}/);
    expect(sidebar).toMatch(/\{tSidebar\(["']contactInfo["']\)\}/);
    expect(sidebar).not.toMatch(/tThread\(["']selectConversation["']\)/);
    expect(customFields).toMatch(/aria-label=\{t\(["']deleteTitle["']\)\}/);
    expect(contactsPage).toMatch(/aria-label=\{t\(["']moreActions["']\)\}/);
    expect(contactsPage).toMatch(/aria-label=\{t\(["']previousPage["']\)\}/);
    expect(contactsPage).toMatch(/aria-label=\{t\(["']nextPage["']\)\}/);
  });
});
