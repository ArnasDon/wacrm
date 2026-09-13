/**
 * O cartão "Asaas" da aba Integrações, montado a partir da linha de config
 * (SEM a chave — a rota já a devolve sem a coluna). Puro.
 */

/**
 * Os códigos que a tela sabe traduzir. ⚠️ A lista mora AQUI, e não dentro do
 * componente, porque há teste cobrando uma chave
 * `Settings.integracoes.asaas.motivo.<codigo>` nos DOIS dicionários para
 * cada um deles — o portão estático de i18n não alcança chave montada, e foi
 * assim que o cartão do tl;dv deixou o buraco.
 */
export const CODIGOS_DO_ASAAS = [
  "chave_invalida",
  "ambiente_errado",
  "sem_permissao",
  "limite",
  "rede",
  "asaas_error",
  "db_error",
  "chave_ilegivel",
  "nao_conectado",
  "conta_trocada",
  "em_curso",
  "cadeado_perdido",
] as const;

export type CodigoDoAsaas = (typeof CODIGOS_DO_ASAAS)[number];

export function codigoConhecido(codigo: string): codigo is CodigoDoAsaas {
  return (CODIGOS_DO_ASAAS as readonly string[]).includes(codigo);
}

/** As origens de vínculo que a tela rotula (`asaas.origem.<origem>`), cobradas por teste. */
export const ORIGENS_DO_VINCULO = ["telefone", "cpf", "email", "criada", "manual", "desvinculado"] as const;

export interface ConfigDoAsaas {
  chave_nome: string | null;
  ambiente: string;
  chave_expira_em: string | null;
  status: string;
  last_sync_at: string | null;
  last_sync_attempt_at: string | null;
  vencidas_listadas_em: string | null;
  last_full_sync_at: string | null;
  /** o cadeado do ciclo (995): preenchido enquanto um ciclo roda */
  sincronizando_desde?: string | null;
  last_error: string | null;
  created_at: string | null;
}

export type EstadoDoAsaas = "nao_conectado" | "conectado" | "erro";

export interface CartaoDoAsaas {
  estado: EstadoDoAsaas;
  chaveNome: string | null;
  /** `true` só quando a conexão NÃO é de produção — a tela avisa em âmbar. */
  sandbox: boolean;
  expiraEm: string | null;
  /** Dias até a chave expirar; negativo quando já expirou; `null` sem validade. */
  diasAteExpirar: number | null;
  ultimaSync: string | null;
  /** o começo da última tentativa, mesmo a que falhou */
  ultimaTentativa: string | null;
  /** o início da última listagem COMPLETA das vencidas */
  vencidasListadasEm: string | null;
  /** já houve alguma sincronização (o espelho tem de onde vir)? */
  nuncaSincronizado: boolean;
  /** um ciclo está rodando agora (o cadeado da 995), desde quando */
  sincronizandoDesde: string | null;
  /** código do último erro (a tela traduz) */
  erro: string | null;
  conectadoEm: string | null;
}

/** A partir de quantos dias antes o cartão avisa que a chave vai expirar. */
export const AVISAR_EXPIRACAO_EM_DIAS = 30;

/**
 * Dias de calendário entre hoje e `AAAA-MM-DD`, no fuso de quem lê.
 * ⚠️ Nunca `new Date("2026-09-01")`: aquilo é meia-noite UTC e retrocede um
 * dia no Brasil — a chave pareceria expirar um dia antes.
 */
export function diasAte(dia: string, agora: Date): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const alvo = new Date(`${dia}T00:00:00`);
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  return Math.round((alvo.getTime() - hoje.getTime()) / 86_400_000);
}

export function cartaoDoAsaas(config: ConfigDoAsaas | null, agora: Date = new Date()): CartaoDoAsaas {
  if (!config) {
    return {
      estado: "nao_conectado",
      chaveNome: null,
      sandbox: false,
      expiraEm: null,
      diasAteExpirar: null,
      ultimaSync: null,
      ultimaTentativa: null,
      vencidasListadasEm: null,
      nuncaSincronizado: true,
      sincronizandoDesde: null,
      erro: null,
      conectadoEm: null,
    };
  }
  return {
    estado: config.status === "erro" ? "erro" : "conectado",
    chaveNome: config.chave_nome,
    sandbox: config.ambiente === "sandbox",
    expiraEm: config.chave_expira_em,
    diasAteExpirar: config.chave_expira_em ? diasAte(config.chave_expira_em, agora) : null,
    ultimaSync: config.last_sync_at,
    ultimaTentativa: config.last_sync_attempt_at ?? null,
    vencidasListadasEm: config.vencidas_listadas_em ?? null,
    nuncaSincronizado: !config.last_sync_at && !config.vencidas_listadas_em,
    sincronizandoDesde: config.sincronizando_desde ?? null,
    erro: config.status === "erro" ? config.last_error : null,
    conectadoEm: config.created_at,
  };
}
