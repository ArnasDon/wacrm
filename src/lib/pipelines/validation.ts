import type { PipelineStage, StageRequiredField } from "@/types";

export type { StageRequiredField };

export const AVAILABLE_REQUIRED_FIELDS: { id: StageRequiredField; label: string }[] = [
  { id: "title", label: "Título do negócio" },
  { id: "value", label: "Valor do negócio (> 0)" },
  { id: "expected_close_date", label: "Data de fechamento esperada" },
  { id: "assigned_to", label: "Responsável atribuído" },
  { id: "notes", label: "Anotações do negócio" },
  { id: "temperature", label: "Temperatura (Quente / Morno / Frio)" },
  { id: "lead_type", label: "Tipo de lead" },
  { id: "last_purchase_date", label: "Data da última compra" },
  { id: "source", label: "Origem do lead" },
  { id: "product", label: "Produto / Serviço" },
  { id: "contact_email", label: "E-mail do contato" },
  { id: "contact_company", label: "Empresa do contato" },
];

export function getRequiredFieldsArray(val: any): StageRequiredField[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }
  return [];
}

export function parseStageConfig(stage: PipelineStage): {
  color: string;
  requiredFields: StageRequiredField[];
} {
  let hexColor = stage.color || "#3b82f6";
  let reqs: StageRequiredField[] = [];

  if (stage.required_fields) {
    reqs = getRequiredFieldsArray(stage.required_fields);
  }

  if (hexColor.includes("|req:")) {
    const parts = hexColor.split("|req:");
    hexColor = parts[0];
    if (parts[1]) {
      const encoded = parts[1].split(",").map((s) => s.trim()).filter(Boolean) as StageRequiredField[];
      if (reqs.length === 0) {
        reqs = encoded;
      }
    }
  }

  return { color: hexColor, requiredFields: reqs };
}

export function encodeStageColorWithReqs(
  color: string,
  reqs: StageRequiredField[]
): string {
  const cleanColor = (color || "#3b82f6").split("|req:")[0];
  if (!reqs || reqs.length === 0) return cleanColor;
  return `${cleanColor}|req:${reqs.join(",")}`;
}

export function validateDealStageRequirements(
  deal: Record<string, any>,
  stage: PipelineStage
): { valid: boolean; missingFields: string[] } {
  const { requiredFields: req } = parseStageConfig(stage);
  if (!req || req.length === 0) return { valid: true, missingFields: [] };

  const missing: string[] = [];

  // Parse notes if JSON
  let parsedTemperature = "";
  let parsedLeadType = "";
  let parsedLastPurchaseDate = "";
  let parsedSource = "";
  let parsedProduct = "";
  let parsedUserNotes = "";

  if (deal.notes) {
    if (typeof deal.notes === "string" && deal.notes.trim().startsWith("{")) {
      try {
        const json = JSON.parse(deal.notes);
        parsedTemperature = json.temperature || "";
        parsedLeadType = json.leadType || "";
        parsedLastPurchaseDate = json.lastPurchaseDate || "";
        parsedSource = json.source || "";
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
    if (field === "title") {
      if (!deal.title || !String(deal.title).trim()) {
        missing.push("Título do negócio");
      }
    } else if (field === "value") {
      if (deal.value === undefined || deal.value === null || Number(deal.value) <= 0) {
        missing.push("Valor do negócio (> 0)");
      }
    } else if (field === "expected_close_date") {
      if (!deal.expected_close_date) {
        missing.push("Data de fechamento esperada");
      }
    } else if (field === "assigned_to") {
      if (!deal.assigned_to) {
        missing.push("Responsável atribuído");
      }
    } else if (field === "notes") {
      if (!parsedUserNotes.trim()) {
        missing.push("Anotações do negócio");
      }
    } else if (field === "temperature") {
      if (!parsedTemperature.trim() || parsedTemperature === "—") {
        missing.push("Temperatura do lead");
      }
    } else if (field === "lead_type") {
      if (!parsedLeadType.trim() || parsedLeadType === "—") {
        missing.push("Tipo de lead");
      }
    } else if (field === "last_purchase_date") {
      if (!parsedLastPurchaseDate.trim()) {
        missing.push("Data da última compra");
      }
    } else if (field === "source") {
      if (!parsedSource.trim() || parsedSource === "—") {
        missing.push("Origem do lead");
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
