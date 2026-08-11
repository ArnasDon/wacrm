import type { PipelineStage, StageRequiredField } from "@/types";

export type { StageRequiredField };

export const AVAILABLE_REQUIRED_FIELDS: { id: StageRequiredField; label: string }[] = [
  { id: "value", label: "Valor do negócio (> 0)" },
  { id: "expected_close_date", label: "Data de fechamento" },
  { id: "assigned_to", label: "Responsável atribuído" },
  { id: "notes", label: "Anotações / Descrição" },
  { id: "product", label: "Produto / Serviço" },
  { id: "contact_email", label: "E-mail do contato" },
  { id: "contact_company", label: "Empresa do contato" },
];

export function validateDealStageRequirements(
  deal: Record<string, any>,
  stage: PipelineStage
): { valid: boolean; missingFields: string[] } {
  const req = stage.required_fields || [];
  if (!req || req.length === 0) return { valid: true, missingFields: [] };

  const missing: string[] = [];

  // Parse notes if JSON
  let parsedProduct = "";
  let parsedUserNotes = "";
  if (deal.notes) {
    if (typeof deal.notes === "string" && deal.notes.trim().startsWith("{")) {
      try {
        const json = JSON.parse(deal.notes);
        parsedProduct = json.product || "";
        parsedUserNotes = json.userNotes !== undefined ? json.userNotes : "";
      } catch {
        parsedUserNotes = deal.notes;
      }
    } else {
      parsedUserNotes = String(deal.notes);
    }
  }

  for (const field of req) {
    if (field === "value") {
      if (deal.value === undefined || deal.value === null || Number(deal.value) <= 0) {
        missing.push("Valor do negócio (> 0)");
      }
    } else if (field === "expected_close_date") {
      if (!deal.expected_close_date) {
        missing.push("Data de fechamento");
      }
    } else if (field === "assigned_to") {
      if (!deal.assigned_to) {
        missing.push("Responsável atribuído");
      }
    } else if (field === "notes") {
      if (!parsedUserNotes.trim()) {
        missing.push("Anotações");
      }
    } else if (field === "product") {
      if (!parsedProduct.trim()) {
        missing.push("Produto / Serviço");
      }
    } else if (field === "contact_email") {
      if (!deal.contact?.email?.trim()) {
        missing.push("E-mail do contato");
      }
    } else if (field === "contact_company") {
      if (!deal.contact?.company?.trim()) {
        missing.push("Empresa do contato");
      }
    }
  }

  return { valid: missing.length === 0, missingFields: missing };
}
