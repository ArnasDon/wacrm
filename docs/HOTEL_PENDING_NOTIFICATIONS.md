# Reception pending-case notifications

A newly recorded hotel reception handoff now inserts an ai_handoff notification for every owner/admin/agent in that account even if the conversation already has an assignee. The same account-scoped team notification is used for completed intake requests. Existing assignments and AI eligibility are preserved; this does not send WhatsApp messages to guests.

The existing guarded conversation update and already-pending check suppress duplicate handoff alerts. Notification insertion is awaited rather than left as an unawaited promise. Other verticals retain their existing assignment/unassigned behavior.

The dashboard browser notification listener now accepts ai_handoff as well as conversation_assigned. Clicking opens the relevant chat. Browser permission must be granted; closed-app Web Push continues through the existing fanout trigger and requires an active device subscription. This change does not grant permissions or register another person's device.
