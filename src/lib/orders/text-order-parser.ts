/**
 * Parser de Pedidos por Texto Livre para WhatsApp.
 *
 * Utiliza o cardápio oficial (assets/js/cardapio.json) para:
 * 1. Detectar intenção de pedido por texto (hasOrderIntent)
 * 2. Extrair sabores/itens, quantidades e calcular valores (parseTextOrder)
 * 3. Identificar endereço de entrega na mensagem (extractAddressFromText)
 * 4. Identificar confirmação de endereço anterior (isAddressConfirmation)
 */

import {
  appendKitchenNotes,
  classifyItemNotes,
  classifyNote,
} from './kitchen-notes';

export interface ParsedOrderItem {
  id: string;
  title: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes?: string;
  requestedText?: string;
}

export interface ParsedOrderResult {
  hasItems: boolean;
  items: ParsedOrderItem[];
  total: number;
  totalFormatted: string;
  deliveryAddress?: string;
  deliveryKind?: 'delivery' | 'retirada';
  rawText: string;
  unresolved?: string[];
  requiresKitchenReview?: boolean;
  /** Transient scope from this inbound, never a new persisted draft field. */
  orderNotes?: string[];
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Mapa de palavras de números para dígitos numéricos */
const WORD_TO_NUMBER: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  'meia duzia': 6,
  'uma duzia': 12,
};

export interface ProductCatalogEntry {
  id: string;
  nome: string;
  preco: number;
  aliases: string[];
}

const CATALOG_PRODUCTS: ProductCatalogEntry[] = [
  // Combos
  {
    id: 'combo_quatro_ovomaltine',
    nome: 'Combo 4 Empanadas + Tortinha de Ovomaltine',
    preco: 69.0,
    aliases: [
      'combo 4 empanadas + tortinha de ovomaltine',
      'combo 4 empanadas e tortinha de ovomaltine',
      'combo 4 ovomaltine',
      'combo ovomaltine',
      'combo tortinha',
    ],
  },
  {
    id: 'combo_quatro_cheesecake',
    nome: 'Combo 4 Empanadas + Cheesecake de Frutas Vermelhas',
    preco: 69.0,
    aliases: [
      'combo 4 empanadas + cheesecake de frutas vermelhas',
      'combo 4 empanadas e cheesecake',
      'combo 4 cheesecake',
      'combo cheesecake',
    ],
  },
  {
    id: 'combo_familia',
    nome: 'Combo Família (8 Empanadas Assadas)',
    preco: 102.0,
    aliases: [
      'combo familia (8 empanadas assadas)',
      'combo familia 8 empanadas',
      'combo familia',
      'combo 8 empanadas',
      'combo oito empanadas',
      'combo 8',
    ],
  },
  {
    id: 'combo_coca',
    nome: 'Combo Coca-Cola',
    preco: 62.9,
    aliases: ['combo coca-cola', 'combo coca cola', 'combo coca'],
  },
  {
    id: 'combo_quatro',
    nome: 'Combo 4 Empanadas',
    preco: 52.9,
    aliases: [
      'combo 4 empanadas',
      'combo quatro empanadas',
      'combo 4',
      'combo quatro',
    ],
  },

  // Bebidas
  {
    id: 'beb_coca_zero_2l',
    nome: 'Coca-Cola zero 2L',
    preco: 25.0,
    aliases: [
      'coca-cola zero 2l',
      'coca zero 2l',
      'coca zero 2 litros',
      'coca zero 2 litro',
      'coca zero dois litros',
      'coca 2l zero',
      'coca 2 litros zero',
    ],
  },
  {
    id: 'beb_coca_2l',
    nome: 'Coca-Cola 2L',
    preco: 25.0,
    aliases: [
      'coca-cola 2l',
      'coca 2l',
      'coca 2 litros',
      'coca 2 litro',
      'coca dois litros',
      'coca garrafa 2l',
      'coca 2 litros original',
      'coca grande',
    ],
  },
  {
    id: 'beb_coca_zero_600',
    nome: 'Coca-Cola Zero 600ml',
    preco: 15.0,
    aliases: [
      'coca-cola zero 600ml',
      'coca zero 600ml',
      'coca zero 600',
      'coca-cola zero 600',
      'coca 600ml zero',
      'coca 600 zero',
    ],
  },
  {
    id: 'beb_coca_600',
    nome: 'Coca-Cola Original 600ml',
    preco: 15.0,
    aliases: [
      'coca-cola original 600ml',
      'coca original 600ml',
      'coca 600ml',
      'coca 600',
      'coca-cola 600ml',
      'coca-cola 600',
      'coca media',
    ],
  },
  {
    id: 'beb_coca_zero_350',
    nome: 'Coca-Cola sem Açúcar 350ml',
    preco: 8.5,
    aliases: [
      'coca-cola sem acucar 350ml',
      'coca sem acucar 350ml',
      'coca sem acucar lata',
      'coca-cola sem acucar lata',
      'coca-cola sem acucar',
      'coca sem acucar',
      'coca zero lata',
      'coca lata zero',
      'coca-cola zero lata',
      'coca-cola zero 350ml',
      'coca zero 350ml',
      'coca zero 350',
      'coca zero',
    ],
  },
  {
    id: 'beb_coca_original_350',
    nome: 'Coca-Cola Original 350ml',
    preco: 8.5,
    aliases: [
      'coca-cola original 350ml',
      'coca original 350ml',
      'coca original lata',
      'coca lata original',
      'coca normal lata',
      'coca lata normal',
      'coca-cola lata',
      'coca lata',
      'coca original',
      'coca normal',
      'coca 350ml',
      'coca 350',
      'coca-cola',
      'coca',
    ],
  },

  // Vinhos
  {
    id: 'vin_san_telmo',
    nome: 'Vinho Tinto Argentino San Telmo Malbec 750ml',
    preco: 79.9,
    aliases: [
      'vinho san telmo malbec',
      'vinho san telmo',
      'san telmo malbec',
      'san telmo',
      'vinho malbec',
    ],
  },
  {
    id: 'vin_la_plata',
    nome: 'Vinho La Plata Branco Argentino 750ml',
    preco: 55.9,
    aliases: [
      'vinho la plata branco',
      'vinho la plata',
      'la plata branco',
      'la plata',
    ],
  },
  {
    id: 'vin_cavic',
    nome: 'Vinho Tinto Seco Argentino Cavic 750ml',
    preco: 40.0,
    aliases: ['vinho cavic', 'vinho tinto cavic', 'cavic tinto', 'cavic'],
  },

  // Empanadas Salgadas e Doces
  {
    id: 'emp_queijo_cebola',
    nome: 'Empanada de Queijo com Cebola Caramelizada',
    preco: 14.0,
    aliases: [
      'queijo com cebola caramelizada',
      'queijo e cebola caramelizada',
      'queijo cebola caramelizada',
      'cebola caramelizada com queijo',
      'cebola caramelizada',
      'queijo com cebola',
      'queijo e cebola',
      'queijo cebola',
    ],
  },
  {
    id: 'emp_queijo_tomate',
    nome: 'Empanada de Queijo, Tomate, Manjericão e Orégano',
    preco: 14.0,
    aliases: [
      'queijo tomate manjericao e oregano',
      'queijo tomate manjericao',
      'queijo tomate e manjericao',
      'queijo com tomate e manjericao',
      'queijo e tomate',
      'queijo com tomate',
      'queijo tomate',
      'caprese',
      'manjericao',
      'queijo',
    ],
  },
  {
    id: 'emp_hamburguer',
    nome: 'Empanada de Carne com Ovos',
    preco: 14.0,
    aliases: [
      'carne com ovos',
      'carne com ovo',
      'carne e ovo',
      'carne e ovos',
      'carne bovina',
      'carne moida',
      'carne tradicional',
      'carne',
    ],
  },
  {
    id: 'emp_ Frango com Espinafre e Cheddar',
    nome: 'Empanada de Frango com Espinafre e Cheddar',
    preco: 14.0,
    aliases: [
      'frango com espinafre e cheddar',
      'frango espinafre cheddar',
      'frango com cheddar',
      'frango cheddar',
      'frango com espinafre',
      'frango',
    ],
  },
  {
    id: 'emp_Espinafre com Ricota e Tomate Seco',
    nome: 'Empanada de Espinafre com Ricota e Tomate Seco',
    preco: 14.0,
    aliases: [
      'espinafre com ricota e tomate seco',
      'espinafre ricota tomate seco',
      'espinafre com ricota',
      'espinafre e ricota',
      'espinafre ricota',
      'ricota com espinafre',
      'ricota e tomate seco',
      'ricota',
      'espinafre',
    ],
  },
  {
    id: 'emp_Escarola com Queijo',
    nome: 'Empanada de Escarola com Queijo',
    preco: 14.0,
    aliases: [
      'escarola com queijo',
      'escarola e queijo',
      'escarola queijo',
      'escarola',
    ],
  },
  {
    id: 'emp_Bacon Cheeseburger',
    nome: 'Empanada Bacon Cheeseburger',
    preco: 14.0,
    aliases: [
      'bacon cheeseburger',
      'bacon cheeseburguer',
      'cheeseburger',
      'cheeseburguer',
      'bacon burger',
      'bacon',
    ],
  },
  {
    id: 'empcalabresa',
    nome: 'Empanada de Calabresa com Cream Cheese',
    preco: 14.0,
    aliases: [
      'calabresa com cream cheese',
      'calabresa e cream cheese',
      'calabresa cream cheese',
      'calabresa creamcheese',
      'calabresa',
    ],
  },
  {
    id: 'emp_palmito',
    nome: 'Empanada de Palmito',
    preco: 14.0,
    aliases: ['palmito pupunha', 'palmito cremoso', 'palmito'],
  },
  {
    id: 'emp_Atum',
    nome: 'Empanada de Atum com Queijo',
    preco: 14.0,
    aliases: ['atum com queijo', 'atum e queijo', 'atum queijo', 'atum'],
  },
  {
    id: 'empchocolate',
    nome: 'Empanada de Chocolate ao Leite com Morango',
    preco: 16.9,
    aliases: [
      'chocolate ao leite com morango',
      'chocolate com morango',
      'chocolate e morango',
      'chocolate morango',
      'morango com chocolate',
      'chocolate',
    ],
  },
  {
    id: 'emp_romeu',
    nome: 'Empanada Romeu e Julieta',
    preco: 14.5,
    aliases: [
      'romeu e julieta',
      'romeu julieta',
      'goiabada com queijo',
      'goiabada e queijo',
      'romeu',
      'goiabada',
    ],
  },
];

/** Alias dictionary only. The legacy prices are NEVER used by the live order flow. */
export function aliasesForCatalogName(name: string): string[] {
  const full = normalize(name);
  const short = full.replace(/^empanadas?\s+(?:de\s+)?/, '');
  const known = CATALOG_PRODUCTS.find(
    (product) => normalize(product.nome) === full
  );
  const shorthand =
    /^(carne|calabresa|escarola|palmito|frango|atum|espinafre)\b/.exec(
      short
    )?.[1];
  return Array.from(
    new Set([
      full,
      short,
      ...(known?.aliases ?? []),
      ...(shorthand ? [shorthand] : []),
    ])
  );
}

// Palavras-chave que indicam intenção de pedir
const ORDER_VERB_PATTERNS = [
  'quero',
  'vou querer',
  'gostaria',
  'manda',
  'mandar',
  'envia',
  'enviar',
  'entrega',
  'entregar',
  'me ve',
  'me vê',
  'pedir',
  'pedido',
  'fazer pedido',
  'faz um pedido',
  'anota',
  'traz',
  'trazer',
];

/**
 * 1. Pré-checagem: detecta se a mensagem possui indicativos de pedido.
 * Utilizado pelo Fast-Path para NÃO disparar saudações ou cardápio estático.
 */
export function hasOrderIntent(text: string): boolean {
  if (!text || text.trim().length === 0) return false;

  const normalized = normalize(text);

  // Perguntas puramente informativas sobre cardápio/horário sem números nem sabores específicos
  const isPureFaq =
    (normalized.includes('cardapio') ||
      normalized.includes('menu') ||
      normalized.includes('horario') ||
      normalized.includes('qual o pix') ||
      normalized.includes('chave pix')) &&
    !/\d/.test(normalized) &&
    !Object.keys(WORD_TO_NUMBER).some((w) =>
      new RegExp(`\\b${w}\\b`).test(normalized)
    );

  if (isPureFaq) return false;

  // Se o parser determinístico já consegue extrair itens válidos do cardápio, tem intenção de pedido garantida!
  const parsed = parseTextOrder(text);
  if (parsed.hasItems || parsed.unresolved?.length) {
    return true;
  }

  // Verifica se há verbos de pedido combinados com termos de cardápio
  const hasVerb = ORDER_VERB_PATTERNS.some((v) => normalized.includes(v));
  const hasFoodTerm = [
    'empanada',
    'empanadas',
    'sabor',
    'sabores',
    'carne',
    'calabresa',
    'queijo',
    'coca',
    'refrigerante',
    'combo',
  ].some((t) => normalized.includes(t));

  if (hasVerb && hasFoodTerm) {
    return true;
  }

  // Verifica padrão de quantidade + qualquer sabor (ex: "2 carne", "1 calabresa", "3 de queijo")
  const quantityNumberMatch =
    /\b(?:\d+|um|uma|dois|duas|tres|quatro|cinco|seis)\s*(?:x\s*)?(?:de\s*)?(?:empanadas?\s*(?:de\s*)?)?[a-z]+/i.test(
      normalized
    );
  if (quantityNumberMatch && hasFoodTerm) {
    return true;
  }

  return false;
}

function rangesOverlap(
  r1: { start: number; end: number },
  r2: { start: number; end: number }
): boolean {
  return r1.start < r2.end && r2.start < r1.end;
}

const RETIRADA_CLAUSE_PATTERNS = [
  /^(?:para|pra|quero|prefiro|vai ser|pode ser|por)?\s*(?:retirada|retirar|retiro)(?:\s+(?:na loja|no local|no balcao|ai))?$/,
  /^(?:vou\s+)?(?:retirar|buscar|pegar)(?:\s+(?:na loja|no local|no balcao|ai))?$/,
  /^(?:no\s+)?balcao$/,
];

const DELIVERY_CLAUSE_PATTERNS = [
  /^(?:para|pra|quero|prefiro|vai ser|pode ser|por)?\s*(?:entrega|delivery|tele[\s-]?entrega)$/,
  /^(?:entrega|entregar|receber)\s+(?:em casa|no\s+(?:meu\s+)?endereco(?:\s+cadastrado)?)$/,
  /^(?:para|pra|quero|prefiro|vai ser|pode ser)?\s*entregar(?:\s+em casa)?$/,
  /^pode entregar$/,
];

const TRAILING_DELIVERY_KIND_REGEX =
  /\s+((?:para|pra)\s+(?:retirada|retirar(?:\s+(?:na\s+loja|no\s+local|no\s+balc[aã]o))?|entrega|delivery|entregar(?:\s+em\s+casa)?)|e\s+(?:para\s+|pra\s+)?(?:retirada|retirar(?:\s+(?:na\s+loja|no\s+local|no\s+balc[aã]o))?|entrega|delivery))\.?$/i;

function matchDeliveryKindClause(
  clause: string
): 'delivery' | 'retirada' | null {
  const cleaned = normalize(clause)
    .replace(/^(?:ok|okay|certo|beleza|sim|entendi)\s+/, '')
    .replace(/[.!]+$/, '')
    .trim();
  if (!cleaned) return null;
  if (RETIRADA_CLAUSE_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return 'retirada';
  }
  if (DELIVERY_CLAUSE_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return 'delivery';
  }
  return null;
}

/**
 * Identifica preferência explícita de entrega (delivery) ou retirada na loja.
 * Retorna null em perguntas, negações, mensagens ambíguas ou endereços parciais.
 */
export function extractDeliveryKindFromText(
  text: string
): 'delivery' | 'retirada' | null {
  if (!text || !text.trim()) return null;
  const trimmed = text.trim();
  if (/[?？]\s*$/.test(trimmed)) return null;
  const norm = normalize(trimmed);
  if (
    /\b(?:qual|quais|quanto|como|onde|aceita|posso|da pra)\b/.test(norm) ||
    /\b(?:nao|nunca|nem|sem)\b/.test(norm)
  ) {
    return null;
  }
  const hasRetiradaTerm = /\b(?:retirada|retirar|retiro|balcao)\b/.test(norm);
  const hasDeliveryTerm =
    /\b(?:entrega|delivery|entregar|tele[\s-]?entrega)\b/.test(norm);
  if (hasRetiradaTerm && hasDeliveryTerm) return null;

  const fullMatch = matchDeliveryKindClause(norm);
  if (fullMatch) return fullMatch;

  const clauses = norm.split(/[\r\n,;!?]+|\s+[-–—]\s+/);
  let detected: 'delivery' | 'retirada' | null = null;
  for (const rawClause of clauses) {
    for (const part of rawClause.split(':')) {
      const candidate = matchDeliveryKindClause(part);
      if (!candidate) continue;
      if (detected && detected !== candidate) return null;
      detected = candidate;
    }
  }
  if (detected) return detected;

  const trailingMatch = TRAILING_DELIVERY_KIND_REGEX.exec(trimmed);
  if (trailingMatch) {
    return matchDeliveryKindClause(trailingMatch[1]);
  }
  return null;
}

function stripDeliveryKindClauses(
  input: string,
  expectedKind: 'delivery' | 'retirada'
): string {
  const cleanedLines: string[] = [];
  for (const line of input.split(/\r?\n/)) {
    if (matchDeliveryKindClause(line) === expectedKind) continue;
    const colonParts = line.split(/(\s*:\s*)/);
    if (
      colonParts.length >= 3 &&
      matchDeliveryKindClause(colonParts[0]) === expectedKind
    ) {
      const rest = colonParts.slice(2).join('').trim();
      if (rest) cleanedLines.push(rest);
      continue;
    }
    const parts = line.split(/(\s*[,;]\s*|\s+[-–—]\s+)/);
    const kept: string[] = [];
    for (let i = 0; i < parts.length; i += 2) {
      const segment = parts[i] ?? '';
      const sep = parts[i - 1] ?? '';
      if (matchDeliveryKindClause(segment) === expectedKind) {
        continue;
      }
      if (kept.length > 0 && sep) kept.push(sep);
      if (segment) kept.push(segment);
    }
    let nextLine = kept.join('').trim();
    const trailing = TRAILING_DELIVERY_KIND_REGEX.exec(nextLine);
    if (trailing && matchDeliveryKindClause(trailing[1]) === expectedKind) {
      nextLine = nextLine.slice(0, trailing.index).trim();
    }
    if (nextLine) cleanedLines.push(nextLine);
  }
  return cleanedLines.join('\n').trim();
}

/**
 * 2. Parser Determinístico de Itens do Cardápio:
 * Extrai itens e quantidades, calculando o valor total oficial.
 */
export function parseTextOrder(text: string): ParsedOrderResult {
  return parseCatalogOrder(
    text,
    CATALOG_PRODUCTS.map((product) => ({
      ...product,
      aliases: [product.nome, ...product.aliases],
    }))
  );
}

/** Production callers must supply the tenant's live catalog, never mock prices. */
export function parseCatalogOrder(
  text: string,
  catalog: ProductCatalogEntry[]
): ParsedOrderResult {
  const source = (text || '').normalize('NFC').trim();
  const address = extractAddressFromText(source);
  const addressStart = address ? source.indexOf(address) : -1;
  const extractedDeliveryKind = address
    ? null
    : extractDeliveryKindFromText(source);
  const deliveryKind: 'delivery' | 'retirada' | undefined = address
    ? 'delivery'
    : (extractedDeliveryKind ?? undefined);
  let orderText = (
    addressStart >= 0
      ? source
          .slice(0, addressStart)
          .replace(
            /(?:,?\s*(?:entregar|entrega|manda)\s*(?:na|no|em)?\s*|vou\s+colocar\s+o\s+endere[cç]o\s+aqui:\s*)$/i,
            ''
          ) +
        '\n' +
        source.slice(addressStart + address!.length)
      : source
  )
    // Replace only addition signs adjacent to an explicit quantity. Keep the
    // character width so matched spans still refer to the original wording;
    // literal '+' inside combo names and genuine kitchen notes stay intact.
    .replace(
      /(^|[\s,;])\+(?=\s*(?:\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|meia\s+duzia|uma\s+duzia)\s*(?:x\s*)?(?:de\s*)?[a-z])/gi,
      '$1 '
    )
    .trim();
  if (extractedDeliveryKind) {
    orderText = stripDeliveryKindClauses(orderText, extractedDeliveryKind);
  }
  const normalized = normalize(orderText);
  const matches: Array<{
    start: number;
    end: number;
    quantity: number;
    product: ProductCatalogEntry;
  }> = [];
  const aliases = catalog
    .flatMap((product) =>
      product.aliases.map((alias) => ({ alias: normalize(alias), product }))
    )
    .sort((a, b) => b.alias.length - a.alias.length);
  const numPattern =
    '(?:\\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|meia\\s+duzia|uma\\s+duzia)';
  for (const { alias, product } of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `\\b(${numPattern})\\s*(?:x\\s*)?(?:de\\s*)?(?:empanadas?\\s*(?:de\\s*)?)?${escaped}(?!\\w)`,
      'gi'
    );
    for (const match of normalized.matchAll(regex)) {
      const start = match.index!;
      const end = start + match[0].length;
      // A minus belongs to the requested amount, never an order-list separator.
      // Leave the clause unresolved rather than silently selling its magnitude.
      if (/[-−–—]\s*$/.test(normalized.slice(0, start))) continue;
      if (matches.some((range) => rangesOverlap(range, { start, end })))
        continue;
      const rawQty = match[1].trim();
      matches.push({
        start,
        end,
        quantity: WORD_TO_NUMBER[rawQty] ?? Number(rawQty),
        product,
      });
    }
  }
  // No-quantity fallback is restricted to explicit purchase verbs.
  if (
    matches.length === 0 &&
    /\b(?:quero|manda|envia|me ve|vou querer)\b/.test(normalized) &&
    !/\d/.test(normalized)
  ) {
    for (const { alias, product } of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`\\b${escaped}(?!\\w)`).exec(normalized);
      if (!match) continue;
      const start = match.index;
      const end = start + match[0].length;
      if (!matches.some((range) => rangesOverlap(range, { start, end })))
        matches.push({ start, end, quantity: 1, product });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  const quantityStarts = Array.from(
    normalized.matchAll(
      new RegExp(`\\b(${numPattern})\\s*(?:x\\s*)?(?:de\\s*)?(?=[a-z])`, 'gi')
    )
  )
    .filter(
      (match) =>
        !matches.some(
          (range) => match.index! > range.start && match.index! < range.end
        )
    )
    .map((match) => match.index!);
  const unresolved: string[] = [];
  // Only explicit conversational framing may be discarded before the first span.
  const firstSpan = Math.min(
    matches[0]?.start ?? orderText.length,
    quantityStarts[0] ?? orderText.length
  );
  if (firstSpan < orderText.length) {
    const prefix = orderText.slice(0, firstSpan).trim();
    const filler =
      /^(?:[\s,;.!]+|(?:boa noite|bom dia|boa tarde|oi|ola|vou querer|quero(?: pedir)?|gostaria(?: de)?(?: pedir)?|por favor|manda|envia|me ve|na verdade|adicione|adicionar|acrescente|acrescentar|mais|e)\b\s*)/;
    let remaining = normalize(prefix);
    while (filler.test(remaining)) remaining = remaining.replace(filler, '');
    if (remaining) unresolved.push(prefix);
  }
  for (const start of quantityStarts) {
    if (matches.some((match) => match.start === start)) continue;
    const end = quantityStarts.find((next) => next > start) ?? orderText.length;
    unresolved.push(
      orderText
        .slice(start, end)
        .replace(/[,\n;\s]+$/g, '')
        .trim()
    );
  }
  const orderNotes: string[] = [];
  const items: ParsedOrderItem[] = matches.flatMap((match) => {
    const next =
      quantityStarts.find((start) => start > match.start) ?? orderText.length;
    const suffix = orderText
      .slice(match.end, next)
      .split(/\r?\n/)
      .filter((line, index) => {
        // Only a whole safe line AFTER the last item is order-wide. Text on
        // the item's own line and all unknown instructions retain their scope.
        if (
          match === matches.at(-1) &&
          index > 0 &&
          classifyNote(line) === 'safe'
        ) {
          orderNotes.push(line.trim());
          return false;
        }
        return true;
      })
      .join('\n')
      .replace(/[,;\n\s]+$/g, '')
      .replace(/\s+e\s*$/i, '')
      .trim();
    if (
      !Number.isSafeInteger(match.quantity) ||
      match.quantity <= 0 ||
      !Number.isFinite(match.product.preco) ||
      match.product.preco <= 0
    ) {
      unresolved.push(orderText.slice(match.start, next).trim());
      return [];
    }
    return [
      {
        id: match.product.id,
        title: match.product.nome,
        quantity: match.quantity,
        unitPrice: match.product.preco,
        totalPrice:
          (Math.round(match.product.preco * 100) * match.quantity) / 100,
        ...(suffix ? { notes: suffix } : {}),
        requestedText: orderText.slice(match.start, match.end).trim(),
      },
    ];
  });
  if (orderNotes.length) {
    for (const item of items)
      item.notes = appendKitchenNotes(item.notes, orderNotes);
  }
  const total =
    items.reduce((sum, item) => sum + Math.round(item.totalPrice * 100), 0) /
    100;
  if (!items.length && !unresolved.length && address && orderText)
    unresolved.push(orderText);
  if (
    !items.length &&
    !unresolved.length &&
    /^(?:quero|manda|envia|me ve|vou querer)\s+/.test(normalized) &&
    !/\b(?:saber|ver|cardapio|menu|horario|preco|pix)\b/.test(normalized)
  )
    unresolved.push(orderText);
  return {
    hasItems: items.length > 0,
    items,
    total,
    totalFormatted: `R$ ${total.toFixed(2).replace('.', ',')}`,
    deliveryAddress: address || undefined,
    ...(deliveryKind ? { deliveryKind } : {}),
    rawText: text,
    unresolved,
    ...(orderNotes.length ? { orderNotes } : {}),
    requiresKitchenReview: items.some(
      (item) => item.notes && classifyItemNotes(item.notes) === 'review'
    ),
  };
}

/**
 * 3. Identifica se a mensagem contém um endereço de entrega.
 */
export function extractAddressFromText(text: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();

  // Prefixos comuns de endereço no Brasil
  const addressPrefixMatch = trimmed.match(
    /\b(?:entregar\s+(?:na|no|em)\s+|endereco(?:\s+de\s+entrega)?(?:\s+e)?:\s*|manda\s+(?:na|no|em)\s+)?(\b(?:rua|r\.|r|av\.|av|avenida|alameda|al\.|al|travessa|tv\.|tv|rodovia|rod\.|rod|estrada|quadra|qd\.|condominio|bairro)\s+[^,\n]+(?:,\s*\d+)?(?:[^.\n]*))/i
  );

  if (addressPrefixMatch && addressPrefixMatch[1]) {
    let candidate = addressPrefixMatch[1].trim();
    if (/^bairro\b/i.test(candidate)) return null;
    // After the house number, quantity and kitchen-note clauses are not address
    // locality. Preserve their full suffix for item extraction or clarification.
    // A number immediately after the street type belongs to its name (Rua 7
    // de Setembro), not the house. A later comma may introduce an order item.
    const houseNumber = Array.from(
      candidate.matchAll(/,\s*\d+[a-z]?\b|\s+\d+[a-z]?\b/gi)
    ).find((match) => {
      const before = normalize(candidate.slice(0, match.index));
      const after = candidate.slice(match.index + match[0].length);
      // CEPs and complement numbers cannot stand in for the house number.
      return (
        /\s/.test(before.trim()) &&
        !/\b(?:cep|apto|apartamento|bloco|casa|lote|quadra|andar|sala|km)\s*\.?\s*$/.test(
          before
        ) &&
        !/\d{8}/.test(match[0]) &&
        !/^-\d/.test(after)
      );
    });
    if (!houseNumber) return null;
    if (houseNumber) {
      const numberEnd = houseNumber.index + houseNumber[0].length;
      // Once locality text is present, a new separated clause is NOT address
      // text by default. Recognize complete address complements, not a growing
      // denylist of kitchen vocabulary. Unknown suffixes stay in orderText so
      // the caller must clarify/review them before checkout.
      const tail = candidate.slice(numberEnd);
      const separators = Array.from(
        // A digit-to-digit hyphen is part of a CEP, not a clause boundary.
        tail.matchAll(/[,;:/()]|(?<!\d)[-–—]|[-–—](?!\d)|\s+e\s+/gi)
      );
      const unknownClause = separators.find((separator, index) => {
        if (!tail.slice(0, separator.index).trim()) return false;
        const clause = tail
          .slice(
            separator.index + separator[0].length,
            separators[index + 1]?.index ?? tail.length
          )
          .trim();
        if (!clause) return false;
        // A repeated street locality after an explicit neighborhood is a
        // bounded city label, not permission to consume arbitrary prose.
        const streetLocality = normalize(candidate.slice(0, houseNumber.index))
          .replace(/^\S+\s+/, '')
          .replace(/,\s*$/, '')
          .trim();
        if (
          separator[0] === ',' &&
          /\b(?:bairro|vila|jardim|parque)\s+[a-z\s]+$/.test(
            normalize(tail.slice(0, separator.index))
          ) &&
          normalize(clause) === streetLocality
        )
          return false;
        // A numbered apartment may precede the locality. Only accept an
        // explicit locality marker here, never arbitrary text after a complement.
        if (
          /^\s*(?:apto|apartamento)\s*\.?\s*\d+(?:\s*[a-z])?\s*$/i.test(
            tail.slice(0, separator.index)
          ) &&
          /^(?:centro|bairro\s+[a-z\s]+)$/i.test(normalize(clause))
        )
          return false;
        return !(
          /^(?:(?:(?:apto|apartamento|bloco|casa|lote|quadra|andar|sala|km)\s*\.?\s*[a-z0-9]+|\d+\s*(?:andar|bloco|apartamento|apto|casa|lote|quadra|sala)|cep\s*\d{5}-?\d{3}|sem\s+(?:numero(?:\s+no\s+portao)?|saida)|com\s+(?:portaria|acesso|entrada))\s*)+$/.test(
            normalize(clause)
          ) ||
          /^(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(
            clause
          )
        );
      });
      if (unknownClause)
        candidate = candidate.slice(0, numberEnd + unknownClause.index).trim();
      const remainder = normalize(candidate).slice(numberEnd);
      const orderBoundary = Array.from(
        remainder.matchAll(
          /(?:[,;/-]\s*|\s+e\s+|\s+)((?:\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|meia\s+duzia|uma\s+duzia)\b\s*(?:x\s*)?(?:de\s*)?(?=[a-z])|(?:sem|com|observacao|obs|quero|adicione|acrescente)\b)/g
        )
      ).find((match) => {
        const before = remainder.slice(0, match.index);
        const clause = remainder.slice(
          match.index! + match[0].length - match[1].length
        );
        // Address complements are not quantities or kitchen instructions. Keep
        // scanning so a commercial clause after a complement is still retained.
        if (
          /^(?:sem\s+(?:numero|saida)|com\s+(?:portaria|acesso|entrada))\b/.test(
            clause
          )
        )
          return false;
        if (
          /^(?:sem|com|observacao|obs|quero|adicione|acrescente)\b/.test(clause)
        )
          return true;
        return (
          !/(?:apto|apartamento|bloco|casa|lote|quadra|andar|sala|km|cep|bairro|vila|jardim|parque|condominio)\s*\.?\s*$/i.test(
            before
          ) &&
          !/^(?:andar|bloco|apartamento|apto|casa|lote|quadra|sala)\b/.test(
            remainder.slice(match.index! + match[0].length)
          )
        );
      });
      if (orderBoundary)
        candidate = candidate.slice(0, numberEnd + orderBoundary.index).trim();
    }
    if (candidate.length >= 8) {
      return candidate;
    }
  }

  return null;
}

/** Structural completeness, not a geocoding or service-area approval. */
export function isCompleteDeliveryAddress(text: string): boolean {
  const address = text.trim();
  if (!address || extractAddressFromText(address) !== address) return false;
  // A street name, explicit house number and locality text after it are required.
  return /^(?:rua|r\.?|avenida|av\.?|alameda|al\.?|travessa|tv\.?|rodovia|rod\.?|estrada|quadra|qd\.?|condominio)\s+[^\n]+?(?:,\s*|\s+)\d+[a-z]?(?:\s*[,;-]\s*|\s+)[^\n]*[a-z][^\n]*$/i.test(
    normalize(address)
  );
}

/**
 * 4. Identifica se o cliente confirmou o endereço anterior cadastrado.
 * Ex: "sim", "no mesmo", "pode ser", "isso", "pode entregar aí", "confirmo"
 */
export function isAddressConfirmation(text: string): boolean {
  if (!text) return false;
  const normalized = normalize(text);

  const confirmationPatterns = [
    'sim',
    'pode ser',
    'no mesmo',
    'nesse mesmo',
    'no mesmo endereco',
    'nesse mesmo endereco',
    'confirmo',
    'confirmado',
    'isso',
    'esse mesmo',
    'pode entregar nesse',
    'pode mandar nesse',
    'o mesmo',
  ];

  return confirmationPatterns.includes(normalized);
}
