export interface ApiContact {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  company: string | null;
  avatar_url: string | null;
  tags: { id: string; name: string; color: string }[];
  created_at: string;
  updated_at: string;
}

type RawTagJoin = { tags: { id: string; name: string; color: string } | null };

/** Flatten a `CONTACT_SELECT` row into the public contact shape. */
export function serializeContact(row: Record<string, unknown>): ApiContact {
  const joins = (row.contact_tags as RawTagJoin[] | undefined) ?? [];
  return {
    id: row.id as string,
    phone: row.phone as string,
    name: (row.name as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    avatar_url: (row.avatar_url as string | null) ?? null,
    tags: joins
      .map((j) => j.tags)
      .filter((t): t is NonNullable<RawTagJoin['tags']> => t != null)
      .map((t) => ({ id: t.id, name: t.name, color: t.color })),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}


export interface ContactInput {
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
}
