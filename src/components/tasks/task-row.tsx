'use client';

// ============================================================
// Uma linha da lista de tarefas (944).
//
// Usada na página `/tarefas`, na aba da ficha do cliente e na seção da
// conversa — por isso ela recebe as ações de fora (o hook
// `use-acoes-da-tarefa`) em vez de as criar: três cópias do hook seriam três
// conjuntos de guardas divergindo.
//
// ⚠️ QUEM DECIDE O QUE APARECE É `podeNaTarefa`, a MESMA função que a rota
// chama antes de escrever. Um botão visível que o servidor recusa é pior que
// botão ausente: o operador clica, nada acontece, e ele não sabe se é falta de
// permissão ou defeito.
// ============================================================

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Clock,
  CornerUpLeft,
  Eye,
  EyeOff,
  MessageSquare,
  MoreVertical,
  Pencil,
  Plus,
  Star,
  Trash2,
  User,
} from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { TarefaNaTela } from '@/hooks/use-tarefas';
import type { Task } from '@/types';
import type { AcoesDaTarefa } from '@/hooks/use-acoes-da-tarefa';
import { podeNaTarefa, type AtorDaTarefa } from '@/lib/tasks/permissoes';
import { dataParaExibir, horaJaPassou, horaParaExibir } from '@/lib/tasks/prazo';
import { cn } from '@/lib/utils';
import { nomeDoContato } from '@/lib/contacts/identidade';

/**
 * A linha aceita a tarefa CRUA ou a enriquecida.
 *
 * ⚠️ Na ficha do cliente e na conversa não há embed de contato nem conversa
 * derivada — quem chama já está dentro do cliente e liga `ocultarCliente`.
 * Exigir os dois campos ali obrigaria a buscar (e a inventar) informação que
 * aquela tela não mostra.
 */
export type TarefaDaLinha = Task &
  Partial<Pick<TarefaNaTela, 'contact' | 'conversation_id'>>;

export interface TaskRowProps {
  tarefa: TarefaDaLinha;
  ator: AtorDaTarefa;
  acoes: AcoesDaTarefa;
  /** Abre o formulário em modo edição. */
  aoEditar: (t: TarefaDaLinha) => void;
  /** Abre o formulário para criar a partir desta (`resposta` ou desdobramento). */
  aoDerivar: (t: TarefaDaLinha, tipo: 'tarefa' | 'resposta') => void;
  /** Esconde o nome do cliente — a ficha e a conversa já dizem de quem é. */
  ocultarCliente?: boolean;
}

export function TaskRow({
  tarefa,
  ator,
  acoes,
  aoEditar,
  aoDerivar,
  ocultarCliente = false,
}: TaskRowProps) {
  const t = useTranslations('Tasks');

  const concluida = tarefa.status === 'concluida';
  const naoLida = !tarefa.lida_em && !concluida;
  const souResponsavel = tarefa.responsavel_user_id === ator.userId;
  const atrasadaHoje =
    !concluida && horaJaPassou(tarefa.vence_em, tarefa.vence_as, new Date());

  const podeLer = podeNaTarefa('marcar-lida', tarefa, ator);
  const podeConcluir = podeNaTarefa('concluir', tarefa, ator);
  const podeImportante = podeNaTarefa('importante', tarefa, ator);
  const podeEditar = podeNaTarefa('editar', tarefa, ator);
  const podeApagar = podeNaTarefa('apagar', tarefa, ator);

  // Responder é devolver satisfação a QUEM PEDIU: só faz sentido para quem
  // recebeu, e só quando quem pediu ainda está na conta (a coluna é
  // ON DELETE SET NULL). Sem o segundo teste, a rota responderia 409 e o
  // operador levaria um erro por clicar num item que a tela ofereceu.
  const podeResponder =
    souResponsavel &&
    !!tarefa.criador_user_id &&
    tarefa.criador_user_id !== ator.userId;

  const ocupada = acoes.ocupada === tarefa.id;
  const hora = horaParaExibir(tarefa.vence_as);

  // O ano só aparece quando NÃO é o corrente: "05 de jan." numa linha lida em
  // dezembro é ambíguo — e prazo de escritório de advocacia cruza ano.
  const mostrarAno =
    tarefa.vence_em.slice(0, 4) !== String(new Date().getFullYear());
  const dataFormatada = dataParaExibir(tarefa.vence_em).toLocaleDateString(
    // ⚠️ `undefined` = locale do navegador. Fixar `'en-US'` faria a data sair
    // em inglês com o app em português — regra do CLAUDE.md.
    undefined,
    { day: '2-digit', month: 'short', ...(mostrarAno ? { year: 'numeric' } : {}) },
  );

  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors',
        naoLida && 'border-primary/40 bg-primary/5',
        ocupada && 'opacity-60',
      )}
    >
      <Checkbox
        checked={concluida}
        disabled={!podeConcluir || ocupada}
        onCheckedChange={(v) => acoes.concluir(tarefa, v === true)}
        aria-label={concluida ? t('reopen') : t('complete')}
        className="mt-0.5 shrink-0"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              'text-sm text-foreground',
              concluida && 'text-muted-foreground line-through',
              naoLida && 'font-semibold',
            )}
          >
            {tarefa.titulo}
          </span>

          {tarefa.tipo === 'resposta' ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <CornerUpLeft className="size-3" />
              {t('chipReply')}
            </span>
          ) : null}

          {tarefa.importante ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-300">
              <Star className="size-3 fill-current" />
              {t('chipImportant')}
            </span>
          ) : null}

          {naoLida ? (
            <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
              {t('chipUnread')}
            </span>
          ) : null}
        </div>

        {tarefa.descricao ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {tarefa.descricao}
          </p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {!ocultarCliente ? (
            // ⚠️ Dois destinos, e o segundo não é consolo: cliente cadastrado à
            // mão que nunca trocou mensagem não TEM conversa para abrir, e a
            // ficha é o lugar certo para ele. Sem o segundo caminho, a linha
            // ficaria sem clique justamente para o cliente sobre o qual alguém
            // criou uma tarefa antes do primeiro contato.
            tarefa.conversation_id ? (
              <Link
                href={`/inbox?c=${tarefa.conversation_id}`}
                className="inline-flex items-center gap-1 text-foreground hover:underline"
              >
                <MessageSquare className="size-3" />
                {nomeDoContato(tarefa.contact, t('unknownContact'))}
              </Link>
            ) : (
              <Link
                href={`/contacts?contact=${tarefa.contact_id}`}
                className="inline-flex items-center gap-1 text-foreground hover:underline"
              >
                <User className="size-3" />
                {nomeDoContato(tarefa.contact, t('unknownContact'))}
              </Link>
            )
          ) : null}

          <span className={cn(atrasadaHoje && 'text-amber-400')}>
            {dataFormatada}
            {hora ? ` · ${hora}` : ''}
          </span>

          {/* Só dentro do dia: para dia passado quem fala é o grupo "Vencidas",
              e repetir o aviso ali seria redundante. */}
          {atrasadaHoje ? (
            <span className="inline-flex items-center gap-1 text-amber-400">
              <Clock className="size-3" />
              {t('timePassed')}
            </span>
          ) : null}

          {/* ⚠️ Lembrete pessoal não leva autoria. Quem cria uma tarefa para si
              mesmo lia "de Rodrigo Tavares Monteiro" na própria linha — o
              formato que a tela usa para dizer "alguém te mandou isto", e que
              ali faz procurar um remetente que não existe. */}
          {tarefa.criador_user_id === tarefa.responsavel_user_id ? null : (
            <span>
              {souResponsavel
                ? t('fromWho', { nome: tarefa.criador_nome ?? t('someone') })
                : t('toWho', { nome: tarefa.responsavel_nome ?? t('someone') })}
            </span>
          )}
        </div>

        {tarefa.tarefa_pai_titulo ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground/80">
            <CornerUpLeft className="size-3 shrink-0" />
            {t('fromTask', { titulo: tarefa.tarefa_pai_titulo })}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={!podeImportante || ocupada}
          onClick={() => acoes.marcarImportante(tarefa, !tarefa.importante)}
          aria-label={tarefa.importante ? t('unmarkImportant') : t('markImportant')}
          title={tarefa.importante ? t('unmarkImportant') : t('markImportant')}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-amber-400 disabled:pointer-events-none disabled:opacity-40"
        >
          <Star className={cn('size-4', tarefa.importante && 'fill-amber-400 text-amber-400')} />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={ocupada}
            aria-label={t('moreActions')}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52 bg-popover text-popover-foreground ring-border">
            {podeLer ? (
              <DropdownMenuItem onClick={() => acoes.marcarLida(tarefa, !tarefa.lida_em)}>
                {tarefa.lida_em ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                {tarefa.lida_em ? t('markUnread') : t('markRead')}
              </DropdownMenuItem>
            ) : null}

            {podeResponder ? (
              <DropdownMenuItem onClick={() => aoDerivar(tarefa, 'resposta')}>
                <CornerUpLeft className="size-4" />
                {t('reply')}
              </DropdownMenuItem>
            ) : null}

            {/* Desdobrar é de qualquer um: criar tarefa é livre, e "não
                atendeu, retentar terça" é o caso central da feature. */}
            <DropdownMenuItem onClick={() => aoDerivar(tarefa, 'tarefa')}>
              <Plus className="size-4" />
              {t('followUp')}
            </DropdownMenuItem>

            {podeEditar || podeApagar ? <DropdownMenuSeparator className="bg-border" /> : null}

            {podeEditar ? (
              <DropdownMenuItem onClick={() => aoEditar(tarefa)}>
                <Pencil className="size-4" />
                {t('edit')}
              </DropdownMenuItem>
            ) : null}

            {podeApagar ? (
              <DropdownMenuItem
                onClick={() => acoes.apagar(tarefa)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-4" />
                {t('delete')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

/** Cabeçalho de grupo com contador — reusado pela página e pela ficha. */
export function TaskGroupHeading({
  rotulo,
  quantidade,
  alerta = false,
}: {
  rotulo: string;
  quantidade: number;
  alerta?: boolean;
}) {
  return (
    <h3
      className={cn(
        'flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider',
        alerta ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {alerta ? <AlertTriangle className="size-3.5" /> : null}
      {rotulo}
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        {quantidade}
      </span>
    </h3>
  );
}
