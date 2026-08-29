export type ConnectionDTO = {
  id: string;
  provider: 'meta' | 'uazapi';
  label: string | null;
  status: string;
  is_primary: boolean;
  display_phone: string | null;
  profile_name: string | null;
  last_connection_error: string | null;
  created_at: string;
};

export function toConnectionDTO(row: Record<string, unknown>): ConnectionDTO {
  return {
    id: row.id as string,
    provider: row.provider as 'meta' | 'uazapi',
    label: (row.label as string) ?? null,
    status: (row.status as string) ?? 'disconnected',
    is_primary: row.is_primary === true,
    display_phone: (row.display_phone as string) ?? null,
    profile_name: (row.profile_name as string) ?? null,
    last_connection_error: (row.last_connection_error as string) ?? null,
    created_at: row.created_at as string,
  };
}
