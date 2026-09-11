# WhatsApp identities

Phone numbers are no longer guaranteed for WhatsApp users. WACRM stores Meta's
Business-Scoped User ID (BSUID) in `contacts.whatsapp_user_id` and the visible
username in `contacts.whatsapp_username`. A username is display metadata only:
it is never used as a stable key.

On inbound webhooks WACRM resolves contacts by BSUID first, then by the existing
account-scoped normalized-phone lookup. When both identifiers are present, the
existing row is enriched instead of a duplicate being created. An outbound send
prefers BSUID and otherwise uses the legacy E.164 phone recipient. The active
conversation also records the recipient type and value.

The Meta Cloud API uses `recipient` for a BSUID and `to` for a phone number.
Public API and broadcast input remain phone-based for backward compatibility.
Twilio lines explicitly reject BSUID-only sends until their configured provider
path supports an external user identifier.
