'use client';

// ============================================================
// Seletor de contato com busca NO BANCO — irmão do `SeletorDeContato`, que
// filtra em JS uma lista já carregada.
//
// ⚠️⚠️ Existe porque o irmão não escala, e o modo de falha é mudo: quem o
// alimenta precisa carregar `contacts` inteiro, e o PostgREST corta em 1000
// linhas sem avisar. Com os ~12.980 contatos da carga da Kommo, o cliente do
// meio do alfabeto em diante não aparecia no seletor — sem erro, sem
// "carregar mais", sem nada. O operador conclui que o cliente não está no
// CRM e cadastra de novo, gerando a ficha duplicada que a carga passou
// semanas evitando.
//
// A forma da busca (debounce + `.limit` no servidor) é a do
// `SeletorDeCliente` da agenda; a casca é a do `SeletorDeContato`, para o
// campo continuar com a cara dos outros seletores do formulário. A regra
// dura — escape do termo e as grafias do nono dígito — mora em
// `lib/contacts/busca-remota.ts`, testada.
//
// Textos chegam por PROPS (como o irmão): o componente não conhece i18n, a
// tela dona traduz.
// ============================================================

import { useEffect, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { createClient } from '@/lib/supabase/client';
import {
  ramosDaBuscaDeContato,
  TETO_DE_RESULTADOS,
} from '@/lib/contacts/busca-remota';
import { identidadeDoContato, nomeDoContato } from '@/lib/contacts/identidade';
import { cn } from '@/lib/utils';

/** Só o que a linha desenha — nunca `select('*')`, que traz a ficha inteira. */
const COLUNAS = 'id, name, phone, instagram_username';

export interface ContatoAchado {
  id: string;
  name: string | null;
  /** NULO na ficha só do Instagram (989). */
  phone: string | null;
  instagram_username?: string | null;
}

/** O resultado CARIMBADO com o termo que o produziu. */
interface Busca {
  termo: string;
  falhou: boolean;
  linhas: ContatoAchado[];
}

const ESPERA_DA_DIGITACAO_MS = 250;

export function SeletorDeContatoRemoto({
  value,
  onChange,
  disabled = false,
  placeholder,
  searchPlaceholder,
  hintText,
  loadingText,
  emptyText,
  failedText,
  moreText,
  ariaLabel,
  className,
}: {
  /** Id do contato escolhido; `''` = nenhum. */
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** Gatilho sem escolha feita. */
  placeholder: string;
  searchPlaceholder: string;
  /** Termo curto demais — o que aparece ANTES de a primeira busca valer. */
  hintText: string;
  loadingText: string;
  emptyText: string;
  failedText: string;
  /** Bateu no teto: diz que há mais e manda refinar. */
  moreText: string;
  ariaLabel?: string;
  /** Ajuste do gatilho ao formulário de quem monta (altura, fundo). */
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');
  const [busca, setBusca] = useState<Busca | null>(null);
  /** O contato escolhido, CARIMBADO com o id de que ele veio. */
  const [escolhido, setEscolhido] = useState<{
    de: string;
    contato: ContatoAchado | null;
  } | null>(null);

  const termoLimpo = termo.trim();
  const filtro = ramosDaBuscaDeContato(termo);

  // ⚠️ "Está buscando?" é DERIVADO da comparação entre o carimbo do
  // resultado e o termo do render atual — nunca um booleano que sobe dentro
  // do efeito. São três ganhos de uma vez: o React Compiler não aceita
  // `setState` síncrono em efeito; a janela do debounce conta como "ainda
  // buscando" (sem isso a lista pinta "nenhum cliente" antes de a consulta
  // sair — a armadilha da lista vazia virando afirmação, que este repositório
  // já pagou quatro vezes); e a resposta ATRASADA de um termo anterior é
  // descartada sozinha, porque o carimbo dela não casa mais.
  const pronto = busca && busca.termo === termoLimpo ? busca : null;

  useEffect(() => {
    // Termo curto demais: a tela mostra a dica, e nada é consultado. Com
    // 12.980 contatos, uma letra devolveria o teto em ordem arbitrária e o
    // operador leria aquilo como "os que existem".
    if (!aberto || filtro === null) return;

    let vivo = true;
    // Espera a digitação parar: sem isto cada tecla vira uma consulta.
    const timer = setTimeout(() => {
      const alvo = termoLimpo;
      void createClient()
        .from('contacts')
        .select(COLUNAS)
        .or(filtro)
        .order('name', { nullsFirst: false })
        .limit(TETO_DE_RESULTADOS)
        .then(({ data, error }) => {
          if (!vivo) return;
          // ⚠️ Falha NÃO vira lista vazia: "nenhum cliente encontrado" sobre
          // uma consulta que não respondeu é a mesma mentira que este
          // seletor existe para acabar.
          setBusca({
            termo: alvo,
            falhou: !!error,
            linhas: error ? [] : ((data ?? []) as ContatoAchado[]),
          });
        });
    }, ESPERA_DA_DIGITACAO_MS);

    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [aberto, filtro, termoLimpo]);

  // O rótulo do gatilho quando a escolha veio de fora (negócio antigo sendo
  // editado, contato semeado pelo painel do inbox): o contato escolhido
  // quase nunca está entre os 20 resultados da busca vigente, e sem esta
  // consulta por id o campo abriria VAZIO sobre um vínculo gravado — salvar
  // apagaria o vínculo sem ninguém ver.
  useEffect(() => {
    if (!value) return;
    if (escolhido?.de === value) return;
    let vivo = true;
    void createClient()
      .from('contacts')
      .select(COLUNAS)
      .eq('id', value)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return;
        // Carimba mesmo em falha: o `de` é o que diz "já tentei", e sem ele
        // o gatilho ficaria em "carregando" para sempre.
        setEscolhido({
          de: value,
          contato: error ? null : ((data as ContatoAchado | null) ?? null),
        });
      });
    return () => {
      vivo = false;
    };
  }, [value, escolhido?.de]);

  // ⚠️ Comparado contra o `value` DO RENDER ATUAL, nunca contra o estado
  // sozinho: o efeito acima é passivo, então existe um render com o id novo
  // e o contato do ANTERIOR — o nome do cliente errado sob o campo certo.
  const jaTentou = !!escolhido && escolhido.de === value;
  const contatoEscolhido = escolhido && escolhido.de === value ? escolhido.contato : null;

  const rotulo = !value
    ? placeholder
    : !jaTentou
      ? loadingText
      : // Contato apagado, ou a consulta falhou: o travessão mantém o campo
        // de pé sem afirmar que não há vínculo (é a saída do seletor da
        // agenda para o mesmo caso).
        nomeDoContato(contatoEscolhido, '—');

  const escolher = (c: ContatoAchado) => {
    // O carimbo é posto AQUI para o gatilho não piscar "carregando" entre o
    // clique e a consulta por id do efeito acima — que nem chega a rodar.
    setEscolhido({ de: c.id, contato: c });
    onChange(c.id);
    setAberto(false);
  };

  return (
    <Popover
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o);
        // A busca nasce limpa a cada abertura — reabrir com o recorte
        // anterior esconderia a lista sem dizer por quê.
        if (o) setTermo('');
      }}
    >
      {/* A cara do SelectTrigger (borda, altura, chevron), largura cheia. */}
      <PopoverTrigger
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          'border-input focus-visible:border-ring focus-visible:ring-ring/50 flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border bg-transparent py-2 pr-2 pl-2.5 text-sm transition-colors outline-none select-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
      >
        <span className={cn('truncate', !value && 'text-muted-foreground')}>
          {rotulo}
        </span>
        <ChevronDown className="text-muted-foreground size-4 shrink-0" />
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 gap-1.5 p-2">
        <Input
          autoFocus
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-8"
          onKeyDown={(e) => {
            // Enter pega o PRIMEIRO resultado — digitou o suficiente para
            // sobrar um, não precisa alcançar o mouse. (O popover é portal:
            // o Enter nem chegaria ao form, mas o preventDefault deixa
            // explícito que ele não submete nada.)
            if (e.key === 'Enter') {
              e.preventDefault();
              const primeiro = pronto && !pronto.falhou ? pronto.linhas[0] : undefined;
              if (primeiro) escolher(primeiro);
            }
          }}
        />
        <div className="-mx-1 max-h-56 overflow-y-auto px-1">
          {filtro === null ? (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">{hintText}</p>
          ) : !pronto ? (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">{loadingText}</p>
          ) : pronto.falhou ? (
            // ⚠️ Par claro/escuro, com a PRIMEIRA cor escolhida para valer
            // nos dois: o variant `dark:` deste projeto pede `.dark` e a
            // página marca `data-mode` — ele está inerte (CLAUDE.md).
            <p className="px-2 py-1.5 text-xs text-red-700 dark:text-red-300">
              {failedText}
            </p>
          ) : pronto.linhas.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">{emptyText}</p>
          ) : (
            <>
              {pronto.linhas.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => escolher(c)}
                  className={cn(
                    'hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    c.id === value && 'bg-accent/50'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {nomeDoContato(c, '—')}
                  </span>
                  {/* O telefone sempre à vista: é ele que confirma "achei o
                      cliente certo" quando a busca foi por número. */}
                  {c.name ? (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {identidadeDoContato(c)}
                    </span>
                  ) : null}
                  {c.id === value ? (
                    <Check className="text-primary size-3.5 shrink-0" />
                  ) : null}
                </button>
              ))}
              {/* ⚠️ Bater no teto tem de ser DITO. Calado, o corte de 20
                  repete em miniatura o corte de 1000 que este seletor veio
                  consertar: numa base com 300 "Silva", o 21º não existiria
                  para quem olha a tela. */}
              {pronto.linhas.length === TETO_DE_RESULTADOS ? (
                <p className="text-muted-foreground px-2 py-1.5 text-xs">
                  {moreText}
                </p>
              ) : null}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
