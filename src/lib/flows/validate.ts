/**
 * Save-time validation for flows.
 *
 * Run before activation (not on every draft save) — drafts are
 * intentionally allowed to be incomplete so users can save progress
 * mid-build. The builder calls these from BOTH client (so the user
 * sees issues live) and server (so a broken POST/PUT can't slip in
 * via direct API call).
 *
 * Three rule categories:
 *   1. Trigger sanity — keyword flows need keywords, etc.
 *   2. Graph integrity — entry node exists, all next_node_key
 *      references resolve, no unreachable nodes, non-terminal nodes
 *      have an outgoing edge.
 *   3. Meta API limits — button title ≤20 chars, ≤3 buttons per
 *      send_buttons, ≤10 list rows total, ≤24 chars per list row
 *      title. Mirrors the runtime checks inside
 *      `src/lib/whatsapp/meta-api.ts` so save-time and send-time
 *      can never disagree.
 *
 * Issues carry enough field info that the builder can highlight the
 * exact input that triggered them. Node-scoped issues include
 * `node_key`; trigger-scoped use `scope: 'trigger'`.
 */

import { INTERACTIVE_LIMITS } from "@/lib/whatsapp/meta-api";

export interface ValidationIssue {
  severity: "error" | "warning";
  scope: "flow" | "trigger" | "node";
  /** Stable node_key the issue is attached to, when scope === 'node'. */
  node_key?: string;
  /** Dotted path to the bad field, e.g. 'buttons.0.title'. */
  field?: string;
  message: string;
}

interface FlowInput {
  name: string;
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
}

interface NodeInput {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}

export function validateFlowForActivation(
  flow: FlowInput,
  nodes: NodeInput[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // ---- name ----
  if (!flow.name || !flow.name.trim()) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "name",
      message: "El nombre del flujo es obligatorio.",
    });
  }

  // ---- trigger ----
  issues.push(...validateTrigger(flow.trigger_type, flow.trigger_config));

  // ---- graph integrity ----
  if (!flow.entry_node_id) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "entry_node_id",
      message: "Elige un nodo de entrada antes de activar.",
    });
  }

  const keys = new Set(nodes.map((n) => n.node_key));
  if (nodes.length === 0) {
    issues.push({
      severity: "error",
      scope: "flow",
      message: "Un flujo necesita al menos un nodo antes de activarse.",
    });
  }

  if (flow.entry_node_id && !keys.has(flow.entry_node_id)) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "entry_node_id",
      message: `El nodo de entrada "${flow.entry_node_id}" no existe.`,
    });
  }

  // Duplicate node_key (the DB UNIQUE constraint catches this on save
  // too, but surfacing it client-side gives a friendlier error path).
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.node_key)) {
      issues.push({
        severity: "error",
        scope: "node",
        node_key: n.node_key,
        message: `node_key duplicado: "${n.node_key}".`,
      });
    }
    seen.add(n.node_key);
  }

  // Per-node rules (Meta limits + dead-end + edge resolution).
  for (const n of nodes) {
    issues.push(...validateNode(n, keys));
  }

  // Reachability — every non-orphan node must be reachable from the
  // entry. Done after per-node validation so we don't double-report
  // when a node has bad config AND is unreachable.
  if (flow.entry_node_id && keys.has(flow.entry_node_id)) {
    const reached = reachableFromEntry(flow.entry_node_id, nodes);
    for (const n of nodes) {
      if (!reached.has(n.node_key)) {
        issues.push({
          severity: "warning",
          scope: "node",
          node_key: n.node_key,
          message: `El nodo "${n.node_key}" no es alcanzable desde el nodo de entrada.`,
        });
      }
    }
  }

  return issues;
}

// ============================================================
// Trigger
// ============================================================

function validateTrigger(
  trigger_type: FlowInput["trigger_type"],
  trigger_config: Record<string, unknown>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (trigger_type === "keyword") {
    const keywords = Array.isArray(trigger_config.keywords)
      ? (trigger_config.keywords as unknown[])
      : null;
    if (!keywords || keywords.length === 0) {
      issues.push({
        severity: "error",
        scope: "trigger",
        field: "trigger_config.keywords",
        message: "Los disparadores por palabra clave necesitan al menos una palabra clave.",
      });
    } else {
      // Empty / whitespace-only keywords are silent no-ops at match
      // time — call them out so the user doesn't think they configured
      // a keyword that never fires.
      const blanks = keywords.filter(
        (k) => typeof k !== "string" || !k.trim(),
      ).length;
      if (blanks > 0) {
        issues.push({
          severity: "warning",
          scope: "trigger",
          field: "trigger_config.keywords",
          message: `${blanks} palabra${blanks === 1 ? "" : "s"} clave vacía${blanks === 1 ? "" : "s"} — no ${blanks === 1 ? "va" : "van"} a coincidir con nada.`,
        });
      }
    }
  }
  // first_inbound_message / manual have no config; nothing to validate.

  return issues;
}

// ============================================================
// Per-node
// ============================================================

function validateNode(
  node: NodeInput,
  knownKeys: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  switch (node.node_type) {
    case "start": {
      const cfg = node.config as { next_node_key?: string };
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "El nodo de inicio debe apuntar a un nodo siguiente.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `El inicio apunta a un nodo inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "send_message": {
      const cfg = node.config as { text?: string; next_node_key?: string };
      if (!cfg.text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "text",
          message: "El nodo de enviar mensaje necesita un texto.",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "El nodo de enviar mensaje debe apuntar a un nodo siguiente.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Enviar mensaje apunta a un nodo inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "send_media": {
      const cfg = node.config as {
        media_type?: "image" | "video" | "document";
        media_url?: string;
        caption?: string;
        next_node_key?: string;
      };
      if (
        !cfg.media_type ||
        !["image", "video", "document"].includes(cfg.media_type)
      ) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "media_type",
          message: "El nodo de enviar multimedia necesita un tipo de archivo (imagen, video o documento).",
        });
      }
      if (!cfg.media_url?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "media_url",
          message: "El nodo de enviar multimedia necesita un archivo (súbelo antes de activar).",
        });
      }
      // Caption cap mirrors Meta's interactive body cap; documented as a
      // hard limit in the WhatsApp Cloud API media-message reference.
      if (cfg.caption && cfg.caption.length > INTERACTIVE_LIMITS.bodyMaxLength) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "caption",
          message: `El pie de foto supera los ${INTERACTIVE_LIMITS.bodyMaxLength} caracteres (límite de WhatsApp).`,
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "El nodo de enviar multimedia debe apuntar a un nodo siguiente.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Enviar multimedia apunta a un nodo inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "send_buttons": {
      const cfg = node.config as {
        text?: string;
        buttons?: Array<{
          reply_id?: string;
          title?: string;
          next_node_key?: string;
        }>;
      };
      if (!cfg.text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "text",
          message: "El nodo de enviar botones necesita un texto.",
        });
      }
      const btns = cfg.buttons ?? [];
      if (btns.length < 1) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "buttons",
          message: "Enviar botones necesita al menos un botón.",
        });
      }
      if (btns.length > INTERACTIVE_LIMITS.maxButtons) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "buttons",
          message: `WhatsApp permite como máximo ${INTERACTIVE_LIMITS.maxButtons} botones por mensaje.`,
        });
      }
      const seenIds = new Set<string>();
      btns.forEach((b, i) => {
        const field = `buttons.${i}`;
        if (!b.reply_id?.trim()) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.reply_id`,
            message: `El botón ${i + 1} necesita un ID de respuesta.`,
          });
        } else if (seenIds.has(b.reply_id)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.reply_id`,
            message: `ID de respuesta de botón duplicado: "${b.reply_id}".`,
          });
        }
        if (b.reply_id) seenIds.add(b.reply_id);

        if (!b.title?.trim()) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.title`,
            message: `El botón ${i + 1} necesita un título.`,
          });
        } else if (b.title.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.title`,
            message: `El título del botón ${i + 1} supera los ${INTERACTIVE_LIMITS.buttonTitleMaxLength} caracteres (límite de WhatsApp).`,
          });
        }

        if (!b.next_node_key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.next_node_key`,
            message: `El botón ${i + 1} necesita un nodo siguiente.`,
          });
        } else if (!knownKeys.has(b.next_node_key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.next_node_key`,
            message: `El botón ${i + 1} apunta a un nodo inexistente: "${b.next_node_key}".`,
          });
        }
      });
      break;
    }

    case "send_list": {
      const cfg = node.config as {
        text?: string;
        button_label?: string;
        sections?: Array<{
          title?: string;
          rows?: Array<{
            reply_id?: string;
            title?: string;
            description?: string;
            next_node_key?: string;
          }>;
        }>;
      };
      if (!cfg.text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "text",
          message: "El nodo de enviar lista necesita un texto.",
        });
      }
      if (!cfg.button_label?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "button_label",
          message: "Enviar lista necesita una etiqueta de botón (el texto para expandir).",
        });
      }
      const sections = cfg.sections ?? [];
      const totalRows = sections.reduce(
        (sum, s) => sum + (s.rows?.length ?? 0),
        0,
      );
      if (totalRows < 1) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "sections",
          message: "Enviar lista necesita al menos una fila.",
        });
      }
      if (totalRows > INTERACTIVE_LIMITS.maxListRowsTotal) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "sections",
          message: `Enviar lista permite como máximo ${INTERACTIVE_LIMITS.maxListRowsTotal} filas en total entre todas las secciones.`,
        });
      }
      const seenIds = new Set<string>();
      sections.forEach((section, si) => {
        const rows = section.rows ?? [];
        rows.forEach((row, ri) => {
          const field = `sections.${si}.rows.${ri}`;
          if (!row.reply_id?.trim()) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.reply_id`,
              message: `La fila ${ri + 1} de la sección ${si + 1} necesita un ID de respuesta.`,
            });
          } else if (seenIds.has(row.reply_id)) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.reply_id`,
              message: `ID de fila de lista duplicado: "${row.reply_id}".`,
            });
          }
          if (row.reply_id) seenIds.add(row.reply_id);

          if (!row.title?.trim()) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.title`,
              message: `La fila ${ri + 1} necesita un título.`,
            });
          } else if (
            row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength
          ) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.title`,
              message: `El título de la fila ${ri + 1} supera los ${INTERACTIVE_LIMITS.listRowTitleMaxLength} caracteres.`,
            });
          }
          if (
            row.description &&
            row.description.length >
              INTERACTIVE_LIMITS.listRowDescriptionMaxLength
          ) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.description`,
              message: `La descripción de la fila ${ri + 1} supera los ${INTERACTIVE_LIMITS.listRowDescriptionMaxLength} caracteres.`,
            });
          }
          if (!row.next_node_key) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.next_node_key`,
              message: `La fila ${ri + 1} necesita un nodo siguiente.`,
            });
          } else if (!knownKeys.has(row.next_node_key)) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.next_node_key`,
              message: `La fila ${ri + 1} apunta a un nodo inexistente: "${row.next_node_key}".`,
            });
          }
        });
      });
      break;
    }

    case "collect_input": {
      const cfg = node.config as {
        prompt_text?: string;
        var_key?: string;
        next_node_key?: string;
      };
      if (!cfg.prompt_text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "prompt_text",
          message: "Recopilar datos necesita un mensaje para enviarle al cliente.",
        });
      }
      if (!cfg.var_key?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "var_key",
          message: "Recopilar datos necesita un var_key donde guardar la respuesta.",
        });
      } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cfg.var_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "var_key",
          message: `El var_key "${cfg.var_key}" debe ser alfanumérico + guion bajo y comenzar con una letra o guion bajo.`,
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Recopilar datos debe apuntar a un nodo siguiente.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Recopilar datos apunta a un nodo inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "condition": {
      const cfg = node.config as {
        subject?: "var" | "tag" | "contact_field";
        subject_key?: string;
        operator?: "equals" | "contains" | "present" | "absent";
        value?: string;
        true_next?: string;
        false_next?: string;
      };
      if (!cfg.subject || !["var", "tag", "contact_field"].includes(cfg.subject)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "subject",
          message: "La condición necesita un sujeto (variable / etiqueta / campo de contacto).",
        });
      }
      if (!cfg.subject_key?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "subject_key",
          message: "La condición necesita un subject_key (nombre de variable, ID de etiqueta o nombre de campo).",
        });
      }
      if (
        !cfg.operator ||
        !["equals", "contains", "present", "absent"].includes(cfg.operator)
      ) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "operator",
          message: "La condición necesita un operador.",
        });
      } else if (
        (cfg.operator === "equals" || cfg.operator === "contains") &&
        (cfg.value === undefined || cfg.value === "")
      ) {
        issues.push({
          severity: "warning",
          scope: "node",
          node_key: node.node_key,
          field: "value",
          message: `El operador "${cfg.operator}" normalmente espera un valor de comparación — un valor vacío solo coincidirá con sujetos vacíos.`,
        });
      }
      for (const branch of ["true_next", "false_next"] as const) {
        const key = cfg[branch];
        if (!key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: branch,
            message: `La condición necesita un nodo para la rama "${branch === "true_next" ? "Sí" : "No"}".`,
          });
        } else if (!knownKeys.has(key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: branch,
            message: `La rama "${branch}" de la condición apunta a un nodo inexistente: "${key}".`,
          });
        }
      }
      break;
    }

    case "set_tag": {
      const cfg = node.config as {
        mode?: "add" | "remove";
        tag_id?: string;
        next_node_key?: string;
      };
      if (!cfg.mode || !["add", "remove"].includes(cfg.mode)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "mode",
          message: "Etiquetar contacto necesita un modo (agregar o quitar).",
        });
      }
      if (!cfg.tag_id) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "tag_id",
          message: "Etiquetar contacto necesita una etiqueta para aplicar.",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Etiquetar contacto debe apuntar a un nodo siguiente.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Etiquetar contacto apunta a un nodo inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "handoff":
    case "end":
      // Terminal nodes have no outgoing edges; nothing to validate
      // beyond their existence.
      break;

    default:
      issues.push({
        severity: "error",
        scope: "node",
        node_key: node.node_key,
        message: `Tipo de nodo desconocido: "${node.node_type}".`,
      });
  }

  return issues;
}

// ============================================================
// Reachability — BFS from the entry, follow outgoing edges per node
// ============================================================

export function reachableFromEntry(
  entryKey: string,
  nodes: NodeInput[],
): Set<string> {
  const byKey = new Map<string, NodeInput>();
  for (const n of nodes) byKey.set(n.node_key, n);

  const visited = new Set<string>();
  const queue: string[] = [entryKey];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    if (visited.has(key)) continue;
    visited.add(key);
    const node = byKey.get(key);
    if (!node) continue;
    for (const next of outgoingEdges(node)) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return visited;
}

function outgoingEdges(node: NodeInput): string[] {
  switch (node.node_type) {
    case "start":
    case "send_message":
    case "send_media":
    case "collect_input":
    case "set_tag": {
      const cfg = node.config as { next_node_key?: string };
      return cfg.next_node_key ? [cfg.next_node_key] : [];
    }
    case "condition": {
      const cfg = node.config as {
        true_next?: string;
        false_next?: string;
      };
      const out: string[] = [];
      if (cfg.true_next) out.push(cfg.true_next);
      if (cfg.false_next) out.push(cfg.false_next);
      return out;
    }
    case "send_buttons": {
      const cfg = node.config as {
        buttons?: Array<{ next_node_key?: string }>;
      };
      return (cfg.buttons ?? [])
        .map((b) => b.next_node_key)
        .filter((k): k is string => !!k);
    }
    case "send_list": {
      const cfg = node.config as {
        sections?: Array<{ rows?: Array<{ next_node_key?: string }> }>;
      };
      const out: string[] = [];
      for (const s of cfg.sections ?? []) {
        for (const r of s.rows ?? []) {
          if (r.next_node_key) out.push(r.next_node_key);
        }
      }
      return out;
    }
    case "handoff":
    case "end":
    default:
      return [];
  }
}
