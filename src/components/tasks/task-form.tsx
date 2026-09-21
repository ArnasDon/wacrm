'use client';

// ============================================================
// O formulário de tarefa (944) — criar, editar, responder e desdobrar.
//
// ⚠️ UM COMPONENTE PARA OS QUATRO, e não quatro telas parecidas. Todos escrevem
// os mesmos campos e chamam a mesma rota; o que muda é o que já vem preenchido
// e o que fica escondido. Em cópias separadas, um campo novo (ou uma validação
// nova) entraria em três e esqueceria a quarta.
//
// ⚠️ RESPONDER NÃO MOSTRA DESTINATÁRIO, de propósito: a resposta volta para
// quem pediu, e é o SERVIDOR que decide isso (ver a rota). Um seletor aqui
// prometeria uma escolha que a rota ignora.
// ============================================================

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { SeletorDeContatoRemoto } from '@/components/contacts/seletor-de-contato-remoto';
import { TETO_DE_RESULTADOS } from '@/lib/contacts/busca-remota';
import { useAuth } from '@/hooks/use-auth';
import { useMembros } from '@/hooks/use-membros';
import type { EdicaoDeTarefa, NovaTarefa } from '@/hooks/use-acoes-da-tarefa';
import { memberLabel } from '@/lib/account/members';
import { diaLocal } from '@/lib/tasks/prazo';
import { MAX_TITULO } from '@/lib/tasks/validar';
import type { Task } from '@/types';

export interface TaskFormProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Cliente da tarefa nova. Ignorado quando há `tarefa` ou `tarefaPai`. */
  contactId?: string;
  /** Preenchido = modo edição. */
  tarefa?: Task | null;
  /** Preenchido = nasce a partir desta (resposta ou desdobramento). */
  tarefaPai?: Task | null;
  /** `resposta` esconde o destinatário — o servidor o fixa em quem pediu. */
  tipo?: 'tarefa' | 'resposta';
  criar: (nova: NovaTarefa) => Promise<Task | null>;
  editar: (t: Task, campos: EdicaoDeTarefa) => Promise<void>;
  salvando?: boolean;
}

export function TaskForm({
  open,
  onOpenChange,
  contactId,
  tarefa,
  tarefaPai,
  tipo = 'tarefa',
  criar,
  editar,
  salvando = false,
}: TaskFormProps) {
  const t = useTranslations('Tasks');
  const { user } = useAuth();
  const {
    membros,
    carregando: carregandoMembros,
    falhou: membrosFalharam,
    recarregar: recarregarMembros,
  } = useMembros();

  const editando = !!tarefa;
  const respondendo = tipo === 'resposta';
  /**
   * Criação GLOBAL (página de Tarefas): sem cliente vindo por prop nem
   * herdado de um pai, o formulário mesmo oferece o seletor de contato.
   */
  const precisaCliente = !editando && !respondendo && !tarefaPai && !contactId;

  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [contatoEscolhido, setContatoEscolhido] = useState('');
  const [venceEm, setVenceEm] = useState('');
  const [venceAs, setVenceAs] = useState('');
  const [importante, setImportante] = useState(false);

  // Repõe os campos toda vez que a caixa abre. Sem isto, fechar sem salvar e
  // reabrir para outro cliente traria o rascunho anterior — e a tarefa sairia
  // com o texto errado sobre a pessoa errada.
  // ⚠️ Repor por efeito é o padrão do projeto para formulário em caixa (ver
  // `contact-form`, `custom-fields-manager`, `pipeline-settings`): o Dialog
  // fica montado entre uma abertura e outra, então o estado inicial do
  // `useState` só valeria a primeira vez. O disable é o mesmo que os três usam.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setTitulo(tarefa?.titulo ?? '');
      setDescricao(tarefa?.descricao ?? '');
      setVenceEm(tarefa?.vence_em ?? diaLocal(new Date()));
      setVenceAs(tarefa?.vence_as?.slice(0, 5) ?? '');
      setImportante(tarefa?.importante ?? false);
      setResponsavel(tarefa?.responsavel_user_id ?? '');
      setContatoEscolhido('');
    }
    // ⚠️ SÓ por abertura/tarefa — `membros` fica FORA destas deps de
    // propósito: com ele aqui, o fetch de membros resolvendo com a caixa
    // aberta re-rodava o reset e apagava o título digitado e o cliente
    // recém-escolhido (achado da revisão de 2026-08-30).
  }, [open, tarefa]);

  // ⚠️ O DESTINATÁRIO NASCE VAZIO quando há com quem escolher, e é uma
  // decisão sobre erro silencioso: com o próprio usuário no padrão, quem
  // esquece de trocar cria para si mesmo uma tarefa que queria delegar — e o
  // colega nunca fica sabendo que havia algo para ele. Vazio, o formulário
  // não deixa salvar sem escolher. Numa conta de uma pessoa só não há
  // escolha a fazer, então cai nela mesma — inclusive quando a lista chega
  // DEPOIS de a caixa abrir (efeito separado do reset acima: preencher o
  // padrão não pode custar os outros campos).
  useEffect(() => {
    // ⚠️ `membrosFalharam` barra a queda para "eu" (#32): a lista vazia de
    // uma falha não prova conta-de-um — auto-atribuir gravava a tarefa no
    // criador e a colega para quem ele delegava nunca ficava sabendo. Em
    // falha o campo fica VAZIO, `podeSalvar` barra e o botão de tentar de
    // novo (abaixo, no render) refaz a busca.
    if (!open || tarefa || carregandoMembros || membrosFalharam) return;
    if (membros.length <= 1) {
      setResponsavel((atual) => atual || (user?.id ?? ''));
    }
  }, [open, tarefa, carregandoMembros, membrosFalharam, membros.length, user?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ⚠️ O CATÁLOGO DE CONTATOS NÃO É MAIS CARREGADO AQUI. Até 20/09/2026 este
  // formulário puxava `contacts` inteiro a cada abertura para filtrar no
  // navegador, e o comentário que ficava neste lugar já mandava trocar por
  // busca digitada "se a base passar de mil". A carga da Kommo põe ~12.980
  // contatos (eram 1.212), e o PostgREST corta em 1000 SEM AVISAR: do meio
  // do alfabeto em diante o cliente sumia do seletor sem erro nenhum, e o
  // operador cadastraria a ficha de novo. Agora quem filtra é o banco, em
  // `SeletorDeContatoRemoto`.

  const podeSalvar =
    !!titulo.trim() &&
    !!venceEm &&
    (respondendo || editando || !!responsavel) &&
    (!precisaCliente || !!contatoEscolhido) &&
    !salvando;

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!podeSalvar) return;

    if (editando && tarefa) {
      await editar(tarefa, {
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        vence_em: venceEm,
        vence_as: venceAs || null,
        // Só manda o destinatário quando mudou — a rota zera o "lida" a cada
        // troca, e mandar o mesmo id de volta não deveria custar isso.
        ...(responsavel && responsavel !== tarefa.responsavel_user_id
          ? { responsavel_user_id: responsavel }
          : {}),
      });
      onOpenChange(false);
      return;
    }

    const nova = await criar({
      // Com pai, a rota IGNORA o contato do corpo e herda o dele — a cadeia
      // inteira fala do mesmo cliente. Mandamos assim mesmo para o caso sem pai.
      contact_id:
        tarefaPai?.contact_id ?? contactId ?? (contatoEscolhido || undefined),
      responsavel_user_id: respondendo ? undefined : responsavel,
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      vence_em: venceEm,
      vence_as: venceAs || null,
      importante,
      tarefa_pai_id: tarefaPai?.id,
      tipo,
    });
    if (nova) onOpenChange(false);
  }

  const titulo_da_caixa = editando
    ? t('editTask')
    : respondendo
      ? t('replyTask')
      : tarefaPai
        ? t('followUpTask')
        : t('newTask');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {titulo_da_caixa}
          </DialogTitle>
          {tarefaPai ? (
            <DialogDescription className="text-muted-foreground">
              {t('fromTask', { titulo: tarefaPai.titulo })}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <form onSubmit={submeter} className="space-y-4">
          {precisaCliente ? (
            <div className="space-y-2">
              <Label className="text-muted-foreground">
                {t('fieldContact')}
              </Label>
              {/* PESQUISÁVEL (pedido do operador, 2026-08-30): 100+ clientes
                  num drop-down comum era caça ao rolar. Busca por nome OU
                  telefone — desde 20/09/2026 NO BANCO, porque a lista
                  carregada inteira batia no teto de 1000 do PostgREST.
                  ⚠️ O teto de resultados vem da CONSTANTE, nunca digitado no
                  dicionário: mudar um sem o outro faz a frase mentir. */}
              <SeletorDeContatoRemoto
                value={contatoEscolhido}
                onChange={setContatoEscolhido}
                placeholder={t('contactPlaceholder')}
                searchPlaceholder={t('contactSearchPlaceholder')}
                hintText={t('contactSearchHint')}
                loadingText={t('loadingContacts')}
                emptyText={t('contactSearchEmpty')}
                failedText={t('contactSearchFailed')}
                moreText={t('contactSearchMore', { count: TETO_DE_RESULTADOS })}
                ariaLabel={t('fieldContact')}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="tf-titulo" className="text-muted-foreground">
              {t('fieldTitle')}
            </Label>
            <Input
              id="tf-titulo"
              value={titulo}
              maxLength={MAX_TITULO}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder={t('titlePlaceholder')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tf-descricao" className="text-muted-foreground">
              {t('fieldDescription')}
            </Label>
            <Textarea
              id="tf-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              placeholder={t('descriptionPlaceholder')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {/* ⚠️ Escondido só ao RESPONDER: quem recebe é quem pediu, e o
              servidor é que decide. Numa conta de uma pessoa o campo FICA
              (pedido do operador, 2026-08-29) — desabilitado, apontando para
              você e com a dica de convidar a equipe: escondido, parecia que
              delegar não existia no produto. */}
          {!respondendo ? (
            <div className="space-y-2">
              <Label className="text-muted-foreground">
                {t('fieldAssignee')}
              </Label>
              {membros.length > 1 || carregandoMembros ? (
                /* Enquanto a lista de membros CARREGA, mostrar o seletor
                   neutro desabilitado — afirmar "único membro" antes de a
                   resposta chegar seria mentira numa conta com equipe (o
                   fetch engole erro devolvendo lista vazia). */
                <Select
                  value={responsavel}
                  onValueChange={(v) => setResponsavel(v ?? '')}
                  disabled={carregandoMembros}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('assigneePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {membros.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {memberLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : membrosFalharam ? (
                /* ⚠️ Falha na busca NÃO vira "único membro" nem cai em
                   "você" (#32): a lista vazia de erro não diz nada sobre a
                   conta, e auto-atribuir gravava no criador a tarefa que
                   ele queria delegar. O campo fica vazio (podeSalvar
                   barra) e o botão refaz a busca sem recarregar a página —
                   o mesmo desenho do invite-member-dialog para o mesmo
                   modo de falha. */
                <div className="space-y-2">
                  <p className="text-muted-foreground text-xs">
                    {t('assigneeLoadFailed')}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={recarregarMembros}
                  >
                    {t('assigneeRetry')}
                  </Button>
                </div>
              ) : (
                <>
                  <Select value="__eu__" disabled onValueChange={() => {}}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__eu__">
                        {t('assigneeOnlyYou')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    {t('assigneeInviteHint')}
                  </p>
                </>
              )}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tf-data" className="text-muted-foreground">
                {t('fieldDueDate')}
              </Label>
              <Input
                id="tf-data"
                type="date"
                value={venceEm}
                onChange={(e) => setVenceEm(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tf-hora" className="text-muted-foreground">
                {t('fieldDueTime')}
              </Label>
              <Input
                id="tf-hora"
                type="time"
                value={venceAs}
                onChange={(e) => setVenceAs(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
              {/* A hora é opcional por pedido do operador — a etiqueta diz. */}
              <p className="text-muted-foreground text-xs">
                {t('dueTimeOptional')}
              </p>
            </div>
          </div>

          {!editando ? (
            <label className="text-muted-foreground flex items-center gap-2 text-sm">
              <Checkbox
                checked={importante}
                onCheckedChange={(v) => setImportante(v === true)}
              />
              {t('fieldImportant')}
            </label>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={salvando}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!podeSalvar}>
              {editando ? t('save') : t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
