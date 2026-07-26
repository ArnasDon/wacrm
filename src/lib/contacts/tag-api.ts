interface ContactTagMutationResult {
  added?: boolean;
  dispatched?: boolean;
  reason?: 'duplicate' | 'max_depth';
}

async function mutateContactTag(
  contactId: string,
  tagId: string,
  method: 'POST' | 'DELETE'
): Promise<ContactTagMutationResult> {
  const response = await fetch(`/api/contacts/${contactId}/tags`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_id: tagId }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & ContactTagMutationResult;
  if (!response.ok) {
    throw new Error(body.error ?? 'Failed to update contact tag');
  }
  return body;
}

export function addContactTag(contactId: string, tagId: string) {
  return mutateContactTag(contactId, tagId, 'POST');
}

export function deleteContactTag(contactId: string, tagId: string) {
  return mutateContactTag(contactId, tagId, 'DELETE');
}
