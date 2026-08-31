import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  })),
}));

import { GET } from './route';

describe('/api/inbox/export route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 Unauthorized when user session is missing', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await GET();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns CSV with header only when no conversations exist', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      return {};
    });

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    expect(response.headers.get('Content-Disposition')).toContain(
      'inbox-replies-',
    );

    const text = await response.text();
    expect(text).toContain(
      'Name,Phone,Email,Company,Tags,Conversation Status,Last Reply,Last Reply Type,Last Reply At',
    );
  });

  it('returns formatted CSV rows only for conversations with customer replies', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    const mockConvRows = [
      {
        id: 'conv-1',
        status: 'open',
        contact: {
          name: 'Jane Doe',
          phone: '+14155550123',
          email: 'jane@example.com',
          company: 'Acme, Inc.',
          contact_tags: [
            { tags: { id: 't1', name: 'VIP', color: '#ff0000' } },
            { tags: { id: 't2', name: 'Lead', color: '#00ff00' } },
          ],
        },
      },
      {
        id: 'conv-2',
        status: 'pending',
        contact: {
          name: 'John Smith',
          phone: '+14155550999',
          email: null,
          company: null,
          contact_tags: [],
        },
      },
      {
        id: 'conv-3',
        status: 'closed',
        contact: {
          name: 'No Reply User',
          phone: '+14155550000',
          contact_tags: [],
        },
      },
    ];

    const mockMessagesRows = [
      {
        conversation_id: 'conv-1',
        content_text: 'Hello, I have a question',
        content_type: 'text',
        created_at: '2026-08-30T10:00:00Z',
      },
      {
        conversation_id: 'conv-2',
        content_text: null,
        content_type: 'image',
        created_at: '2026-08-30T11:00:00Z',
      },
    ];

    mocks.from.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            order: () => Promise.resolve({ data: mockConvRows, error: null }),
          }),
        };
      }
      if (table === 'messages') {
        return {
          select: () => ({
            in: () => ({
              eq: () => ({
                order: () =>
                  Promise.resolve({ data: mockMessagesRows, error: null }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const buffer = await response.clone().arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // Verify UTF-8 BOM byte sequence EF BB BF
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);

    const text = await response.text();
    const lines = text.trim().split('\n');
    // Header + 2 rows (conv-3 excluded since no customer message)
    expect(lines.length).toBe(3);

    // Row 1 (conv-1 with comma in Company "Acme, Inc." -> quoted)
    expect(lines[1]).toContain('Jane Doe,+14155550123,jane@example.com,"Acme, Inc.",VIP; Lead,open,"Hello, I have a question",text,2026-08-30T10:00:00Z');

    // Row 2 (conv-2 with image media reply -> [image], empty tags -> empty field)
    expect(lines[2]).toContain('John Smith,+14155550999,,,,pending,[image],image,2026-08-30T11:00:00Z');
  });
});
