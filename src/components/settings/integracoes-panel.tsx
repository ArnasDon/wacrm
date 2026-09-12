'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CalendarDays, ChevronDown, RefreshCw, Sparkles } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AI_PROVIDER_DEFAULT_MODEL, AI_PROVIDER_MODELS } from '@/lib/ai/defaults';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import { AsaasCard } from './asaas-card';
import { MetaAdsCard } from './meta-ads-card';
import { CalendlyCard } from './calendly-card';
import { TldvCard } from './tldv-card';
import { SettingsChip, type ChipVariant } from './settings-chip';
import { SettingsPanelHead } from './settings-panel-head';
import { cn } from '@/lib/utils';
import type {
  CartaoDeIntegracao,
  EstadoDaIntegracao,
} from '@/lib/integracoes/montar';

/**
 * Aba Configurações → Integrações.
 *
 * Um cartão por integração externa (Gemini / OpenAI / Anthropic /
 * Google Agenda) com chip de estado AO VIVO e, expandido, ONDE aquela
 * credencial é usada — módulo por módulo, com o modelo de cada um e de
 * onde esse modelo vem.
 *
 * ⚠️ É AQUI que a chave e o modelo de cada MÓDULO se configuram. A tela
 * de Agentes de IA ficou com o COMPORTAMENTO do agente de conversa
 * (instruções da empresa, resposta automática, base de conhecimento) e
 * com o modelo DELE. A separação é o ponto: antes, um único campo
 * "Modelo" servia ao assistente, à resposta automática, ao Playground e
 * ao Radar, e trocar um trocava todos sem avisar.
 *
 * ⚠️ A escrita reusa `POST /api/ai/config`, a ÚNICA rota que grava
 * `ai_configs` — nada de regra duplicada. Como aquela rota reescreve a
 * linha inteira, o formulário CARREGA a config atual e devolve os campos
 * que não edita; sem isso um save daqui zeraria as instruções da empresa
 * e desligaria o assistente.
 *
 * ⚠️ Escopo: o agente PADRÃO da conta (`channel_id IS NULL`). Não há
 * escritor de agente por canal em lugar nenhum do app.
 *
 * A carga é em dois tempos: `?ping=0` pinta a tela na hora com a
 * configuração; a segunda chamada roda os pings de verdade (uma geração
 * mínima por agente) e resolve os chips. O botão repete só o ping.
 */

/** O que `GET /api/ai/config` devolve (sem as chaves, por desenho). */
interface ConfigAtual {
  configured?: boolean;
  has_key?: boolean;
  provider?: string;
  model?: string;
  radar_model?: string | null;
  system_prompt?: string | null;
  is_active?: boolean;
  auto_reply_enabled?: boolean;
  auto_reply_max_per_conversation?: number;
}

/**
 * Traduz o CÓDIGO de falha que a rota devolve. A rota nunca manda a
 * mensagem do provedor: ela embute o eco da chave enviada, e sairia num
 * print de suporte. Código desconhecido cai no genérico.
 */
function motivoLegivel(
  t: ReturnType<typeof useTranslations>,
  codigo: string | undefined
): string {
  const conhecidos = [
    'invalid_key',
    'rate_limited',
    'timeout',
    'network',
    'provider_error',
    'chave_ilegivel',
  ];
  return t(
    `motivo.${codigo && conhecidos.includes(codigo) ? codigo : 'provider_error'}`
  );
}

/** Nomes próprios — não passam pelo dicionário. */
const NOMES: Record<CartaoDeIntegracao['id'], string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  google_calendar: 'Google Agenda',
};

const CHIP_POR_ESTADO: Record<
  EstadoDaIntegracao,
  { variant: ChipVariant; className?: string }
> = {
  ok: { variant: 'ok' },
  erro: { variant: 'err' },
  conferindo: { variant: 'warn' },
  nao_configurado: { variant: 'muted' },
};

export function IntegracoesPanel() {
  const t = useTranslations('Settings.integracoes');
  // ⚠️ `RequireRole` renderiza o fallback TAMBÉM enquanto o papel carrega
  // (fail closed, por desenho). Com a frase "só administradores" ali, todo
  // admin lia uma acusação de não ser admin durante o fetch do perfil — o
  // esqueleto diz a mesma coisa que a tela vai dizer, sem mentir.
  const { profileLoading } = useAuth();

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <RequireRole
        min="admin"
        fallback={
          profileLoading ? (
            <Esqueleto />
          ) : (
            <p className="text-sm text-muted-foreground">{t('somenteAdmin')}</p>
          )
        }
      >
        <Conteudo />
      </RequireRole>
    </div>
  );
}

function Esqueleto() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-lg border border-border bg-muted/40"
        />
      ))}
    </div>
  );
}

function Conteudo() {
  const t = useTranslations('Settings.integracoes');
  const [cartoes, setCartoes] = useState<CartaoDeIntegracao[] | null>(null);
  const [testando, setTestando] = useState(false);
  // ⚠️ Guarda do "Tentar de novo": `testando` só cobre a fase do ping, e na
  // janela da carga barata (carregar(false)) um duplo clique disparava DUAS
  // cadeias completas — cada uma com um ping PAGO por agente.
  const [repetindo, setRepetindo] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  // Evita escrever estado em componente já desmontado.
  const vivoRef = useRef(true);
  // ⚠️ Separado do `vivoRef` de propósito: no StrictMode do `next dev` o
  // efeito roda monta→limpa→monta, e sem esta guarda a abertura da aba
  // dispararia DUAS rodadas de gerações pagas (uma por agente, vezes
  // duas). O `vivoRef` sozinho não resolve — ele é rearmado na segunda
  // execução e ressuscita a cadeia da primeira.
  const disparouRef = useRef(false);

  const carregar = useCallback(async (ping: boolean) => {
    if (ping) setTestando(true);
    try {
      const res = await fetch(
        `/api/cb/integracoes/status${ping ? '' : '?ping=0'}`
      );
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as { cartoes: CartaoDeIntegracao[] };
      if (vivoRef.current) {
        setCartoes(corpo.cartoes);
        setFalhou(false);
      }
    } catch {
      if (vivoRef.current) setFalhou(true);
    } finally {
      if (ping && vivoRef.current) setTestando(false);
    }
  }, []);

  useEffect(() => {
    vivoRef.current = true;
    if (!disparouRef.current) {
      disparouRef.current = true;
      void (async () => {
        await carregar(false);
        await carregar(true);
      })();
    }
    return () => {
      vivoRef.current = false;
    };
  }, [carregar]);

  if (falhou && !cartoes) {
    // ⚠️ Com um botão de repetir: sem ele, a única saída deste estado era o
    // F5 — o botão "Atualizar" só existe no estado carregado, e o
    // `disparouRef` (guarda de StrictMode) impede um novo disparo
    // automático. Repetir refaz as duas cargas na ordem da montagem:
    // config sem ping primeiro (barata), pings depois.
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('carregarFalhou')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={testando || repetindo}
          onClick={() =>
            void (async () => {
              if (repetindo) return;
              setRepetindo(true);
              try {
                await carregar(false);
                await carregar(true);
              } finally {
                if (vivoRef.current) setRepetindo(false);
              }
            })()
          }
        >
          <RefreshCw className={cn('size-4', (testando || repetindo) && 'animate-spin')} />
          {t('tentarDeNovo')}
        </Button>
      </div>
    );
  }

  if (!cartoes) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg border border-border bg-muted/40"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-3">
        {/* ⚠️ Sem isto, a recarga disparada por um save (ou pelo botão)
            falhava em silêncio: `falhou` só era lido no estado sem
            cartões, e os chips continuavam mostrando o retrato pré-save
            com cara de atual. */}
        {falhou ? (
          <span className="text-xs text-red-600 dark:text-red-300">
            {t('recarregarFalhou')}
          </span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void carregar(true)}
          disabled={testando}
        >
          <RefreshCw className={cn('size-4', testando && 'animate-spin')} />
          {testando ? t('testando') : t('atualizar')}
        </Button>
      </div>

      {cartoes.map((cartao) => (
        <Cartao
          key={cartao.id}
          cartao={cartao}
          aberto={aberto === cartao.id}
          onToggle={() =>
            setAberto((atual) => (atual === cartao.id ? null : cartao.id))
          }
          onSalvo={() => void carregar(true)}
        />
      ))}
      {/* Meta Ads (Fase 4 do funil comercial): cartão com rota própria
          (`GET /api/cb/meta-ads`) — não passa pelo `montarCartoes`, que é
          o das chaves de IA; o token nunca chega ao navegador. */}
      <MetaAdsCard />
      {/* Calendly (977): mesmo desenho do Meta Ads — rota própria
          (`GET /api/cb/calendly`), nenhum segredo chega ao navegador. */}
      <CalendlyCard />
      {/* tl;dv (987): mesmo desenho — rota própria (`GET /api/cb/tldv`), a
          chave nunca chega ao navegador. */}
      <TldvCard />
      {/* Asaas (991): mesmo desenho. Por enquanto guarda a chave e roda o
          levantamento da conta (só leitura) — o espelho das cobranças e a
          régua de cobrança dependem dos números dele. */}
      <AsaasCard />
    </div>
  );
}

function ChipDeEstado({ cartao }: { cartao: CartaoDeIntegracao }) {
  const t = useTranslations('Settings.integracoes');
  // O Google Agenda ainda não tem conexão — "não conectada" comunica
  // melhor que "não configurada" (não há onde configurar).
  const rotulo =
    cartao.id === 'google_calendar'
      ? t('chipNaoConectado')
      : cartao.estado === 'ok'
        ? t('chipOk')
        : cartao.estado === 'erro'
          ? t('chipErro')
          : cartao.estado === 'conferindo'
            ? t('chipConferindo')
            : t('chipNaoConfigurado');
  const { variant, className } = CHIP_POR_ESTADO[cartao.estado];
  return (
    <SettingsChip variant={variant} className={className}>
      {rotulo}
    </SettingsChip>
  );
}

function Cartao({
  cartao,
  aberto,
  onToggle,
  onSalvo,
}: {
  cartao: CartaoDeIntegracao;
  aberto: boolean;
  onToggle: () => void;
  onSalvo: () => void;
}) {
  const t = useTranslations('Settings.integracoes');
  const ehGoogle = cartao.id === 'google_calendar';
  const Icone = ehGoogle ? CalendarDays : Sparkles;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={aberto}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <Icone className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {NOMES[cartao.id]}
        </span>
        <ChipDeEstado cartao={cartao} />
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            aberto && 'rotate-180'
          )}
        />
      </button>

      {aberto ? (
        <div className="space-y-4 border-t border-border p-4 text-sm">
          {ehGoogle ? (
            <>
              <p className="max-w-[62ch] text-muted-foreground">
                {t('googleDesc')}
              </p>
              <Button type="button" variant="outline" size="sm" disabled>
                {t('emBreve')}
              </Button>
            </>
          ) : (
            <>
              {cartao.agentes.length > 0 ? (
                <div>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t('agentes')}
                  </p>
                  <ul className="space-y-1.5">
                    {cartao.agentes.map((a) => (
                      <li
                        key={a.configId}
                        className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                      >
                        <Bolinha ok={a.teste === null ? null : a.teste.ok} />
                        <span className="text-foreground">
                          {a.escopo === 'padrao'
                            ? t('agentePadrao')
                            : (a.canalLabel ?? '—')}
                        </span>
                        <code className="text-[11px] text-muted-foreground">
                          {a.model}
                        </code>
                        {/* ⚠️ Chave boa + interruptor desligado é estado
                            real e invisível de outro jeito: Radar e
                            transcrição rodam assim mesmo (leem a config
                            com `requireActive: false`), mas o assistente
                            e a resposta automática ficam mudos. Sem esta
                            marca o cartão diria só "Funcionando". */}
                        {!a.isActive ? (
                          <span className="text-xs text-amber-600 dark:text-amber-300">
                            {t('desligado')}
                          </span>
                        ) : null}
                        {a.teste && !a.teste.ok ? (
                          <span className="text-xs text-red-600 dark:text-red-300">
                            {t('falha', { motivo: motivoLegivel(t, a.teste.motivo) })}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <Usos cartao={cartao} />

              {/* ⚠️ A dica "cole a chave abaixo" mora DENTRO do formulário,
                  depois do early-return de outro-provedor-ativo: fora dele
                  ela aparecia nos cartões da OpenAI/Anthropic prometendo um
                  campo que o formulário, logo abaixo, decidia não desenhar. */}
              <FormularioDaChave
                provedor={cartao.id as 'gemini' | 'openai' | 'anthropic'}
                semAgentes={cartao.agentes.length === 0}
                onSalvo={onSalvo}
              />

              <Link
                href="/agents"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                {t('abrirAgentes')}
              </Link>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * "Onde é usada": um módulo por linha, com o MODELO e de onde ele vem.
 *
 * ⚠️ Nunca esconder a seção inteira quando não há uso ativo. Era o que a
 * versão anterior fazia, e é justamente o caso em que o operador mais
 * precisa da tela: ele acabou de cadastrar a chave "para o Radar" e
 * precisa descobrir que o Radar está desligado no canal.
 */
function Usos({ cartao }: { cartao: CartaoDeIntegracao }) {
  const t = useTranslations('Settings.integracoes');
  if (cartao.usos.length === 0) return null;

  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('usos')}
      </p>
      <ul className="space-y-2">
        {cartao.usos.map((u) => (
          <li key={`${u.modulo}:${u.modelo}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-foreground">{t(`modulo.${u.modulo}`)}</span>
            <code className="text-[11px] text-muted-foreground">{u.modelo}</code>
            <span className="text-[11px] text-muted-foreground">
              ({t(`origem.${u.origem}`)})
            </span>
            {u.canais.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {t('emCanais', { canais: u.canais.join(', ') })}
              </span>
            ) : null}
            {u.indisponivel ? (
              <span className="text-xs text-amber-600 dark:text-amber-300">
                {t(`indisponivel.${u.indisponivel}`)}
              </span>
            ) : null}
            {u.canaisDesligados.length > 0 && !u.indisponivel ? (
              <span className="text-xs text-muted-foreground">
                {t('desligadoEm', { canais: u.canaisDesligados.join(', ') })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Verde = ping ok, vermelho = falhou, cinza = ainda não testado. */
function Bolinha({ ok }: { ok: boolean | null }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        ok === null
          ? 'bg-muted-foreground'
          : ok
            ? 'bg-emerald-500'
            : 'bg-red-500'
      )}
    />
  );
}

/**
 * Configuração da credencial e do modelo do Radar, dentro do cartão.
 *
 * ⚠️ CARREGA a config atual e a devolve inteira no save. `POST
 * /api/ai/config` reescreve a linha: `system_prompt` ausente vira NULL e
 * `is_active` ausente vira false. Sem este eco, salvar a chave aqui
 * apagaria as instruções da empresa e desligaria o assistente — sem
 * nenhum aviso, e a partir de uma tela que fala de outro assunto.
 *
 * A chave em branco significa "mantém a guardada" (mesma convenção da
 * tela de Agentes); só é enviada quando o admin digita uma nova.
 */
function FormularioDaChave({
  provedor,
  semAgentes,
  onSalvo,
}: {
  provedor: 'gemini' | 'openai' | 'anthropic';
  /** O cartão não tem nenhum agente — mostra a dica de primeira chave. */
  semAgentes: boolean;
  onSalvo: () => void;
}) {
  const t = useTranslations('Settings.integracoes');
  const [cfg, setCfg] = useState<ConfigAtual | null>(null);
  // ⚠️ `cfg === null` TRAVA o Salvar, e falha de carga NÃO destrava. O eco
  // dos campos que este formulário não edita só protege quando há o que
  // ecoar: salvar com a config não carregada mandaria `system_prompt:
  // null` e `is_active: false` ecoados DE NADA — apagando as instruções
  // da empresa e desligando o assistente a partir de uma tela que fala de
  // outro assunto. Conta ainda não configurada NÃO é falha: o GET devolve
  // `{ configured: false }` e o formulário funciona como primeira
  // configuração.
  const [falhouCfg, setFalhouCfg] = useState(false);
  const [chave, setChave] = useState('');
  const [modeloRadar, setModeloRadar] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [recado, setRecado] = useState<{ ok: boolean; texto: string } | null>(
    null
  );

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch('/api/ai/config');
        if (!res.ok) throw new Error(String(res.status));
        const corpo = (await res.json()) as ConfigAtual;
        if (!vivo) return;
        setCfg(corpo);
        setModeloRadar(corpo.radar_model ?? '');
      } catch {
        if (vivo) setFalhouCfg(true);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  // ⚠️ Só edita a linha cujo provedor é ESTE. Salvar a partir do cartão
  // da OpenAI quando a conta usa Gemini trocaria o provedor da conta
  // inteira — uma consequência que o cartão não anuncia. Com `cfg` nulo
  // (carregando ou falhou) NÃO cai aqui: o formulário renderiza travado,
  // nunca fail-open nos três cartões.
  if (cfg?.configured && cfg.provider !== provedor) {
    return (
      <p className="max-w-[62ch] text-xs text-muted-foreground">
        {t('outroProvedorAtivo', { atual: NOMES[cfg.provider as 'gemini'] ?? cfg.provider })}
      </p>
    );
  }

  if (falhouCfg) {
    return (
      <p className="max-w-[62ch] text-xs text-muted-foreground">
        {t('configFalhou')}
      </p>
    );
  }

  // Na PRIMEIRA configuração (conta sem agente) não há modelo salvo para
  // ecoar — a rota exige um, então cai no padrão do provedor.
  const modeloDoAgente = cfg?.model ?? '';
  const modeloParaSalvar = modeloDoAgente || AI_PROVIDER_DEFAULT_MODEL[provedor];

  async function salvar() {
    setSalvando(true);
    setRecado(null);
    try {
      const corpo: Record<string, unknown> = {
        provider: provedor,
        // Ecoados para não serem zerados — ver a nota do componente.
        model: modeloParaSalvar,
        system_prompt: cfg?.system_prompt ?? null,
        is_active: cfg?.is_active ?? false,
        auto_reply_enabled: cfg?.auto_reply_enabled ?? false,
        auto_reply_max_per_conversation:
          cfg?.auto_reply_max_per_conversation ?? 3,
        radar_model: modeloRadar.trim() || null,
      };
      if (chave.trim()) corpo.api_key = chave.trim();

      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const dados = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setRecado({ ok: false, texto: dados.error ?? t('salvarFalhou') });
        return;
      }
      setChave('');
      setRecado({ ok: true, texto: t('salvo') });
      onSalvo();
    } catch {
      setRecado({ ok: false, texto: t('salvarFalhou') });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
      {/* A dica de primeira chave mora AQUI, junto do campo que ela
          promete — nos cartões de outro provedor este JSX nem renderiza. */}
      {semAgentes ? (
        <p className="max-w-[62ch] text-xs text-muted-foreground">
          {t('naoConfiguradaDica')}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`chave-${provedor}`} className="text-muted-foreground">
            {t('campoChave')}
          </Label>
          <Input
            id={`chave-${provedor}`}
            type="password"
            autoComplete="off"
            value={chave}
            placeholder={cfg?.has_key ? t('chaveGuardada') : t('chaveVazia')}
            onChange={(e) => setChave(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`radar-${provedor}`} className="text-muted-foreground">
            {t('campoModeloRadar')}
          </Label>
          <Input
            id={`radar-${provedor}`}
            list={`modelos-${provedor}`}
            value={modeloRadar}
            placeholder={
              modeloDoAgente
                ? t('modeloHerdado', { model: modeloDoAgente })
                : t('modeloHerdadoVazio')
            }
            onChange={(e) => setModeloRadar(e.target.value)}
          />
          {/* Sugestão, nunca allow-list: o campo aceita qualquer id. */}
          <datalist id={`modelos-${provedor}`}>
            {AI_PROVIDER_MODELS[provedor].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
      </div>

      <p className="max-w-[62ch] text-xs text-muted-foreground">
        {t('modeloRadarDica')}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          onClick={() => void salvar()}
          disabled={salvando || cfg === null}
        >
          {salvando ? t('salvando') : t('salvar')}
        </Button>
        {recado ? (
          <span
            className={cn(
              'text-xs',
              recado.ok
                ? 'text-emerald-600 dark:text-emerald-300'
                : 'text-red-600 dark:text-red-300'
            )}
          >
            {recado.texto}
          </span>
        ) : null}
      </div>
    </div>
  );
}
