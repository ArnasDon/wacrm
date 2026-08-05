// Re-export del cliente service-role único del sistema.
// Sin duplicar lógica ni instancia: la fuente canónica es
// src/lib/automations/admin-client.ts (mismo singleton lazy usado
// por el webhook de WhatsApp y el motor de automatizaciones).
export { supabaseAdmin } from "@/lib/automations/admin-client"
