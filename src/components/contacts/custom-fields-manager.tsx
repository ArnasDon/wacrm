'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { createClient } from '@/lib/supabase/client';
import { TIPO_DATA } from '@/lib/contacts/campo-data';
import { gerarChaveDeCampo } from '@/lib/contacts/chave-do-campo';
import { OPCAO_RESERVADA, opcoesDoCampo } from '@/lib/contacts/campo-opcoes';
import { camposFaltantes } from '@/lib/contacts/campos-de-traqueamento';
import {
  agruparCampos,
  chaveDoBloco,
  moverCampo,
  ordenarGrupos,
  posicoesDoBloco,
  type BlocoDeCampos,
} from '@/lib/contacts/grupos-de-campos';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { CustomField, GrupoDeCampos } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Check,
  Copy,
  GripVertical,
  Loader2,
  Lock,
  Plus,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

interface CustomFieldsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog wrapper around {@link CustomFieldsPanel}, used on the Contacts page.
 * The same panel is rendered inline under Settings → Custom Fields, so the
 * editing UI lives in one place. Radix unmounts the dialog content on close,
 * so the panel remounts (and refetches) on each open.
 */
export function CustomFieldsManager({
  open,
  onOpenChange,
}: CustomFieldsManagerProps) {
  const t = useTranslations('Contacts.customFields');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t('title')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('desc')}
          </DialogDescription>
        </DialogHeader>
        {/* ⚠️ A altura padrão é curta DE PROPÓSITO aqui: o `DialogContent`
            deste projeto não tem teto de altura (é `top-1/2` com
            `-translate-y-1/2`, sem `max-h`), então uma lista alta cresce para
            fora da viewport e não há barra de rolagem que a alcance. Quem tem
            espaço é a tela de Configurações, e é ela que passa outra altura. */}
        <CustomFieldsPanel />
      </DialogContent>
    </Dialog>
  );
}

/** Prefixos dos ids do arrastar. Um `DndContext` só governa três coisas —
 *  blocos (arrastáveis), campos (arrastáveis) e a ÁREA de cada bloco (alvo de
 *  soltura) —, e sem prefixo o id de um grupo colidiria com o do próprio bloco
 *  dele. Ver `handleDragEnd`. */
const PREFIXO_GRUPO = 'grupo:';
const PREFIXO_CAMPO = 'campo:';
const PREFIXO_BLOCO = 'bloco:';

/**
 * Create / rename / delete account-wide custom contact field definitions,
 * repartidas em BLOCOS (migration 966). Per-contact values are edited
 * elsewhere (contact detail → Custom Fields); this only manages the field
 * catalogue. Admin+ gated by the caller — `custom_fields` e
 * `cb_grupos_de_campos` também exigem admin na RLS, como defesa em
 * profundidade.
 *
 * @param alturaDaLista Classe de altura máxima da lista rolável. O padrão
 *   curto serve ao diálogo da página de Contatos (ver a nota lá em cima);
 *   Configurações passa uma altura maior porque tem a página inteira.
 */
export function CustomFieldsPanel({
  alturaDaLista = 'max-h-72',
}: {
  alturaDaLista?: string;
}) {
  const t = useTranslations('Contacts.customFields');
  const supabase = createClient();
  // `ownerUserId`, não `user`: `custom_fields.user_id` CASCADEia de
  // `auth.users` e leva `contact_custom_values` junto — campo criado por um
  // admin que depois sai da equipe (login apagado no dashboard) sumiria com
  // os valores preenchidos de TODO cliente. Grava-se o dono da conta.
  const { ownerUserId, accountId } = useAuth();

  const [fields, setFields] = useState<CustomField[]>([]);
  const [grupos, setGrupos] = useState<GrupoDeCampos[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  // Tipo do campo. Até a 935 todo campo nascia 'text' e a coluna era
  // decorativa; 'datetime' é o que o gatilho de lembrete lê, e a 948 fechou
  // o universo em (text, datetime, select, number) com CHECK.
  const [newType, setNewType] = useState<string>('text');
  /**
   * O identificador (948). Sugerido a partir do nome ENQUANTO o operador não
   * o tocar — depois disso a sugestão para de atropelar o que ele digitou.
   * O gerador é o gêmeo TS do SQL, então o que aparece aqui é o que o banco
   * gravaria de qualquer forma.
   */
  const [newKey, setNewKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  /** Opções do tipo `select`, separadas por vírgula (viram JSON no banco). */
  const [newOptions, setNewOptions] = useState('');
  /**
   * Bloco em que o campo novo nasce (966). `''` é o bloco Geral — o
   * `grupo_id` NULO, que não tem linha no banco. Substituiu o seletor de
   * `categoria`: o operador escolhe ONDE o campo aparece, e a categoria (a
   * marca semântica que a API v1 expõe) fica no default 'geral'.
   */
  const [newGrupoId, setNewGrupoId] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [novoGrupo, setNovoGrupo] = useState('');
  const [criandoGrupo, setCriandoGrupo] = useState(false);
  const [semeando, setSemeando] = useState(false);
  /**
   * ⚠️ Só vira `true` quando as DUAS consultas voltaram OK pelo menos uma
   * vez. Este é o ÚNICO painel que ESCREVE blocos, e era o único que tratava
   * falha de consulta como lista vazia: com `grupos = []`, `agruparCampos`
   * joga tudo no Geral (fallback de exibição, correto) e o arrastar seguinte
   * PERSISTIA esse fallback — `grupo_id: null` para a conta inteira, via
   * RPC, sem erro em lugar nenhum (achado #02 do plano de 31/08). Enquanto
   * for `false`, a lista nem renderiza (caixa de erro + tentar de novo), e
   * os dois escritores de ordenação recusam por cima.
   */
  const [catalogoConfiavel, setCatalogoConfiavel] = useState(false);

  /**
   * (Re)carrega catálogo e blocos.
   *
   * ⚠️ `comSpinner` só na PRIMEIRA carga, e isso é o conserto de um defeito
   * medido: o spinner substitui a lista DENTRO do contêiner rolável, o
   * conteúdo desaba de 1215px para 84px, e o navegador GRAMPEIA o `scrollTop`
   * em 0. Como nada o restaura depois, renomear um campo lá embaixo jogava a
   * pessoa de volta ao topo de uma lista de 30 campos — a cada renomeação, e
   * o mesmo valia para as outras sete escritas.
   *
   * (Medido em 01/09: rolagem 139 → 0. O contêiner NÃO desmonta — quem
   * some é o conteúdo dele, e é o suficiente.)
   *
   * No refetch a lista fica na tela, com os dados velhos por alguns
   * centésimos. Não é mentira: a linha que está sendo escrita já mostra o
   * próprio spinner (`busyId`), então o retorno visual existe e é local.
   */
  /**
   * ⚠️ Número de série das buscas. Com o refetch silencioso a lista fica
   * editável enquanto a consulta anterior ainda está em voo, e duas coisas
   * davam errado (achado do Codex no PR #103): duas buscas podem VOLTAR
   * fora de ordem (a mais velha por último, sobrescrevendo a mais nova), e
   * um arrastar otimista feito durante o voo era ATROPELADO pela resposta
   * antiga — a ordem certa estava no banco e a tela mostrava a velha. A
   * regra: só a busca MAIS NOVA escreve, e todo escritor otimista bump o
   * número (`invalidarBuscasEmVoo`) para a resposta que já viajava ser
   * descartada — e recarrega DEPOIS do sucesso, para a tela terminar com o
   * que o banco tem.
   */
  const buscaRef = useRef(0);
  const invalidarBuscasEmVoo = () => {
    buscaRef.current += 1;
  };

  const fetchFields = useCallback(async (comSpinner = false) => {
    if (!accountId) return;
    const minha = ++buscaRef.current;
    if (comSpinner) setLoading(true);
    const [camposRes, gruposRes] = await Promise.all([
      supabase
        .from('custom_fields')
        .select('*')
        .order('posicao', { nullsFirst: false })
        .order('field_name'),
      supabase
        .from('cb_grupos_de_campos')
        .select('*')
        .order('posicao')
        .order('nome'),
    ]);
    // Resposta de busca superada — por outra busca ou por uma escrita
    // otimista — não toca no estado. Ver `buscaRef`.
    if (minha !== buscaRef.current) return;
    // Falha NÃO é vazio: preserva o estado anterior e avisa — o mesmo que as
    // duas telas de leitura (ficha e painel da conversa) já fazem.
    if (camposRes.error || gruposRes.error) {
      toast.error(t('loadError'));
      setLoading(false);
      return;
    }
    setFields((camposRes.data as CustomField[] | null) ?? []);
    setGrupos((gruposRes.data as GrupoDeCampos[] | null) ?? []);
    setCatalogoConfiavel(true);
    setLoading(false);
  }, [supabase, accountId, t]);

  // Load the field list on mount once the account is known. The setters
  // inside fetchFields run after the Supabase await — not synchronously in
  // the effect body — so the cascade the lint rule warns about doesn't apply.
  useEffect(() => {
    if (accountId) {
      // ⚠️ O ÚNICO chamador com spinner: aqui não há lista na tela para
      // preservar, e sem ele a caixa nasceria vazia com cara de "não há
      // campo nenhum". Os outros oito (as escritas) recarregam em silêncio.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchFields(true);
    }
  }, [accountId, fetchFields]);

  // ⚠️ `incluirVazios`: aqui o bloco vazio TEM de aparecer. É a área onde se
  // solta o primeiro campo dele — sem ela, um bloco recém-criado sumiria da
  // própria tela que acabou de criá-lo e seria inalcançável.
  const blocos = useMemo(
    () => agruparCampos(fields, grupos, { incluirVazios: true }),
    [fields, grupos]
  );

  /** Quais dos 10 campos padrão de traqueamento (949) ainda não existem. */
  const faltantes = useMemo(() => camposFaltantes(fields), [fields]);
  /**
   * O bloco escolhido no formulário, resolvido contra a lista ATUAL.
   *
   * ⚠️ Não é o `newGrupoId` cru: apagar o bloco que estava selecionado deixa um
   * id órfão no estado, o `<select>` fica sem opção correspondente (visualmente
   * em branco) e o próximo campo criado morreria na FK com um "não foi possível
   * criar" que não explica nada. Resolvendo aqui, o formulário volta sozinho
   * para "Geral" — que é o que a tela já está mostrando.
   */
  const grupoEscolhido = grupos.some((g) => g.id === newGrupoId)
    ? newGrupoId
    : '';
  /** O nome do bloco em que o semeador vai criá-los — o do formulário acima. */
  const nomeDoBlocoNovo =
    grupos.find((g) => g.id === grupoEscolhido)?.nome ?? t('groupGeneral');

  const sensors = useSensors(
    // A distância impede que um clique no campo de nome vire arrastar. A alça
    // é a única a receber os listeners, mas a folga também evita o arrasto
    // acidental de quem só quis clicar nela.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  /** Case-insensitive name clash within the loaded list. */
  function isDuplicate(name: string, exceptId?: string): boolean {
    const lower = name.toLowerCase();
    return fields.some(
      (f) => f.id !== exceptId && f.field_name.toLowerCase() === lower
    );
  }

  /** "A, B , ,B" → ["A","B"] — apara, tira vazio e repetido. */
  function parseOpcoes(texto: string): string[] {
    return [
      ...new Set(
        texto
          .split(',')
          .map((o) => o.trim())
          // `Boolean` tira o vazio; a reservada é o sentinela do item
          // "limpar" do Select — gravá-la criaria uma opção que o contato
          // nunca consegue escolher (a escolha viraria "limpar valor").
          .filter((o) => Boolean(o) && o !== OPCAO_RESERVADA)
      ),
    ];
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    if (!accountId || !ownerUserId) {
      toast.error(t('toastNoAccount'));
      return;
    }
    if (isDuplicate(name)) {
      toast.error(t('toastDuplicate', { name }));
      return;
    }

    setCreating(true);
    const { error } = await supabase.from('custom_fields').insert({
      field_name: name,
      field_type: newType,
      // A chave viaja NORMALIZADA (o gatilho da 948 normalizaria igual, mas
      // mandar pronto evita a tela mostrar uma coisa e o banco gravar outra).
      // Vazia → null, e o gatilho gera do nome.
      field_key: gerarChaveDeCampo(newKey.trim() || name) || null,
      field_options:
        newType === 'select' ? { opcoes: parseOpcoes(newOptions) } : null,
      // `posicao` fica NULA de propósito: o campo novo nasce no FIM do bloco
      // (as consultas ordenam com NULLS LAST). Calculá-la aqui exigiria que
      // todo escritor de `custom_fields` soubesse fazer o mesmo.
      grupo_id: grupoEscolhido || null,
      user_id: ownerUserId,
      account_id: accountId,
    });
    setCreating(false);

    if (error) {
      // 23505 = o índice único da chave (948): identificador já usado na conta.
      toast.error(
        error.code === '23505' ? t('toastKeyTaken') : t('toastCreateFailed')
      );
      return;
    }
    toast.success(t('toastCreated', { name }));
    setNewName('');
    setNewType('text');
    setNewKey('');
    setKeyTouched(false);
    setNewOptions('');
    // O bloco escolhido FICA: quem está montando o bloco "Bancário" cria
    // vários campos seguidos, e voltar para "Geral" a cada criação faria o
    // segundo campo cair no lugar errado sem nada avisando.
    await fetchFields();
  }

  /**
   * Opções de um campo `select` existente — o catálogo muda com o tempo
   * ("Origem da dívida" ganha uma origem nova) e apagar/recriar o campo
   * perderia os valores já gravados nos contatos.
   */
  async function handleSaveOptions(
    field: CustomField,
    texto: string
  ): Promise<boolean> {
    setBusyId(field.id);
    const { error } = await supabase
      .from('custom_fields')
      .update({ field_options: { opcoes: parseOpcoes(texto) } })
      .eq('id', field.id);
    setBusyId(null);
    if (error) {
      toast.error(t('toastOptionsFailed'));
      return false;
    }
    await fetchFields();
    return true;
  }

  /** Returns true on success so the row can keep the new name, false so it
   *  reverts to the previous one. No-ops (blank / unchanged) count as success. */
  async function handleRename(
    field: CustomField,
    nextName: string
  ): Promise<boolean> {
    const name = nextName.trim();
    if (!name || name === field.field_name) return true;
    if (isDuplicate(name, field.id)) {
      toast.error(t('toastDuplicate', { name }));
      return false;
    }
    setBusyId(field.id);
    const { error } = await supabase
      .from('custom_fields')
      .update({ field_name: name })
      .eq('id', field.id);
    setBusyId(null);
    if (error) {
      toast.error(t('toastRenameFailed'));
      return false;
    }
    await fetchFields();
    return true;
  }

  async function handleDelete(field: CustomField) {
    // O campo espelhado (1000) não tem botão de apagar, e o banco recusa o
    // DELETE mesmo assim. A guarda aqui só evita um confirm sem sentido.
    if (field.espelho) return;
    if (!window.confirm(t('deleteConfirm', { name: field.field_name }))) {
      return;
    }
    setBusyId(field.id);
    const { error } = await supabase
      .from('custom_fields')
      .delete()
      .eq('id', field.id);
    setBusyId(null);
    if (error) {
      toast.error(t('toastDeleteFailed'));
      return;
    }
    toast.success(t('toastDeleted', { name: field.field_name }));
    await fetchFields();
  }

  // ---------------------------------------------------------------
  // Blocos (966)
  // ---------------------------------------------------------------

  async function handleCreateGrupo() {
    const nome = novoGrupo.trim();
    if (!nome) return;
    if (!accountId) {
      toast.error(t('toastNoAccount'));
      return;
    }
    if (grupos.some((g) => g.nome.toLowerCase() === nome.toLowerCase())) {
      toast.error(t('toastGroupDuplicate', { name: nome }));
      return;
    }
    setCriandoGrupo(true);
    // Nasce no FIM da lista de blocos. `posicao` tem DEFAULT 0 no banco, e
    // deixar o default faria todo bloco novo empatar com o primeiro.
    const posicao = grupos.reduce((max, g) => Math.max(max, g.posicao), 0) + 1;
    const { error } = await supabase
      .from('cb_grupos_de_campos')
      .insert({ nome, posicao, account_id: accountId });
    setCriandoGrupo(false);
    if (error) {
      toast.error(
        error.code === '23505'
          ? t('toastGroupDuplicate', { name: nome })
          : t('toastGroupCreateFailed')
      );
      return;
    }
    setNovoGrupo('');
    await fetchFields();
  }

  async function handleRenameGrupo(
    grupo: GrupoDeCampos,
    nextName: string
  ): Promise<boolean> {
    const nome = nextName.trim();
    if (!nome || nome === grupo.nome) return true;
    if (
      grupos.some(
        (g) => g.id !== grupo.id && g.nome.toLowerCase() === nome.toLowerCase()
      )
    ) {
      toast.error(t('toastGroupDuplicate', { name: nome }));
      return false;
    }
    setBusyId(grupo.id);
    const { error } = await supabase
      .from('cb_grupos_de_campos')
      .update({ nome })
      .eq('id', grupo.id);
    setBusyId(null);
    if (error) {
      toast.error(t('toastGroupRenameFailed'));
      return false;
    }
    await fetchFields();
    return true;
  }

  async function handleDeleteGrupo(grupo: GrupoDeCampos) {
    if (!window.confirm(t('deleteGroupConfirm', { name: grupo.nome }))) return;
    setBusyId(grupo.id);
    const { error } = await supabase
      .from('cb_grupos_de_campos')
      .delete()
      .eq('id', grupo.id);
    setBusyId(null);
    if (error) {
      toast.error(t('toastGroupDeleteFailed'));
      return;
    }
    // Os campos do bloco NÃO somem: a FK é `ON DELETE SET NULL (grupo_id)`, e
    // eles reaparecem no bloco Geral. É por isso que o refetch traz os dois.
    //
    // ⚠️ RENORMALIZA o Geral resultante antes do refetch (M7 do plano
    // 31/08): os campos chegam com a `posicao` que tinham DENTRO do bloco
    // apagado, colidem com as do Geral, e `ordenarCampos` desempata pelo
    // nome — a ordem que o operador montou embaralhava na ficha de TODO
    // cliente. A lista vai na ordem em que a tela os mostrará (Geral atual
    // primeiro, depois os do bloco apagado), pela MESMA RPC do arrastar.
    const geralAtual = blocos.find((b) => b.grupo === null)?.campos ?? [];
    const doApagado = blocos.find((b) => b.grupo?.id === grupo.id)?.campos ?? [];
    if (doApagado.length > 0) {
      const { error: reordErr } = await supabase.rpc(
        'cb_ordenar_campos_personalizados',
        { p_campos: posicoesDoBloco([...geralAtual, ...doApagado], null) },
      );
      // Falha aqui é só de ORDEM (nada se perdeu) — o aviso padrão do
      // arrastar serve, e o refetch abaixo mostra o que o banco tem.
      if (reordErr) toast.error(t('toastReorderFailed'));
    }
    toast.success(t('toastGroupDeleted', { name: grupo.nome }));
    await fetchFields();
  }

  /**
   * Semeia o catálogo padrão de traqueamento (949) — só os que FALTAM, e a
   * falta é medida pela CHAVE em qualquer categoria: um `utm_source` já criado
   * como campo geral não pode nascer de novo (a chave é única por conta).
   *
   * ⚠️ Mudou de casa na 966. Ficava na aba Traqueamento do painel da conversa,
   * que deixou de existir; criar campo é gestão de CATÁLOGO e o catálogo é
   * aqui. Os campos nascem no bloco escolhido no formulário acima — o botão
   * diz qual, porque um lote de dez campos caindo no bloco errado é trabalhoso
   * de desfazer.
   */
  async function handleSeed() {
    if (!ownerUserId || !accountId || faltantes.length === 0) return;
    setSemeando(true);
    // ⚠️ `ignoreDuplicates`, não insert seco: `faltantes` é foto de quando o
    // painel carregou, e uma chave criada nesse meio-tempo (outra aba, outro
    // admin) fazia o 23505 derrubar o LOTE inteiro — e o retry repetia a mesma
    // falha até recarregar. Com DO NOTHING, a repetida é pulada e as demais
    // nascem. O alvo é o índice único da 948 (conta + chave).
    const { error } = await supabase.from('custom_fields').upsert(
      faltantes.map((c) => ({
        field_name: c.nome,
        field_key: c.key,
        field_type: 'text',
        // A marca semântica continua: é ela que a API v1 expõe como
        // `category` e que a futura API de Conversões vai ler. O BLOCO é
        // outra coisa, e é o de cima.
        categoria: 'tracking',
        grupo_id: grupoEscolhido || null,
        user_id: ownerUserId,
        account_id: accountId,
      })),
      { onConflict: 'account_id,field_key', ignoreDuplicates: true }
    );
    setSemeando(false);
    if (error) {
      toast.error(t('toastSeedFailed'));
      return;
    }
    toast.success(t('toastSeeded', { count: faltantes.length }));
    await fetchFields();
  }

  // ---------------------------------------------------------------
  // Arrastar
  // ---------------------------------------------------------------

  /**
   * De QUALQUER id do arrastar para a chave do bloco em que ele está.
   *
   * ⚠️ Existe porque três nós ocupam praticamente a mesma caixa: o bloco
   * arrastável, a ÁREA de soltura dentro dele e as linhas de campo. O
   * `closestCenter` devolve o que tiver o centro mais perto — e entre o nó do
   * bloco e a área dele, que têm o MESMO centro, o desempate é a ordem de
   * registro no `DndContext`, não a geometria. Aceitar só um id por caso fazia
   * "soltar num bloco vazio" e "reordenar blocos" funcionarem de forma
   * INTERMITENTE: o gesto certo, o `over` "errado", e o arrastar sem efeito
   * nenhum — sem erro, sem toast, sem nada a depurar.
   */
  function blocoDoAlvo(alvo: string): string | null {
    if (alvo.startsWith(PREFIXO_BLOCO)) return alvo.slice(PREFIXO_BLOCO.length);
    if (alvo.startsWith(PREFIXO_GRUPO)) return alvo.slice(PREFIXO_GRUPO.length);
    if (alvo.startsWith(PREFIXO_CAMPO)) {
      const id = alvo.slice(PREFIXO_CAMPO.length);
      const dono = blocos.find((b) => b.campos.some((c) => c.id === id));
      return dono ? chaveDoBloco(dono.grupo?.id ?? null) : null;
    }
    return null;
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const arrastado = String(active.id);
    const alvo = String(over.id);
    if (arrastado === alvo) return;

    if (arrastado.startsWith(PREFIXO_GRUPO)) {
      const destino = blocoDoAlvo(alvo);
      // O Geral não entra: não tem linha no banco, então não há posição a
      // gravar — e ele é sempre o primeiro de qualquer forma.
      if (!destino || destino === chaveDoBloco(null)) return;
      await reordenarGrupos(arrastado.slice(PREFIXO_GRUPO.length), destino);
      return;
    }

    if (!arrastado.startsWith(PREFIXO_CAMPO)) return;
    // Soltou EM CIMA de um campo → aquela posição exata. Em qualquer outro nó
    // do bloco → fim do bloco. `moverCampo` distingue os dois pelo formato.
    const destino = alvo.startsWith(PREFIXO_CAMPO)
      ? alvo.slice(PREFIXO_CAMPO.length)
      : blocoDoAlvo(alvo);
    if (!destino) return;
    await reordenarCampos(arrastado.slice(PREFIXO_CAMPO.length), destino);
  }

  /**
   * Move um campo para outro bloco pelo SELETOR da linha (sem arrastar).
   *
   * Reusa o mesmo caminho do arrastar de propósito — soltar na área de um
   * bloco também manda o campo para o fim dele. Duas rotas de escrita para o
   * mesmo efeito divergiriam na primeira mudança de regra.
   */
  function moverParaBloco(field: CustomField, grupoId: string | null) {
    if ((field.grupo_id ?? null) === grupoId) return;
    void reordenarCampos(field.id, chaveDoBloco(grupoId));
  }

  async function reordenarCampos(campoId: string, alvo: string) {
    // Cerca do achado #02: sem catálogo confiável o estado pode ser o
    // fallback de exibição (tudo no Geral), e gravá-lo zeraria os blocos da
    // conta. A lista nem renderiza nesse estado — isto protege o próximo
    // refactor de render, não o operador de hoje.
    if (!catalogoConfiavel) return;
    const novos = moverCampo(blocos, campoId, alvo);
    if (!novos) return;

    // Otimista: o arrastar tem de parecer instantâneo. O estado anterior fica
    // guardado para a volta, senão uma falha de rede deixaria a tela mostrando
    // uma ordem que o banco não tem — e o operador arrumaria "de novo" o que
    // nunca foi salvo.
    invalidarBuscasEmVoo();
    const anterior = fields;
    setFields(
      novos.flatMap((bloco) =>
        bloco.campos.map((campo, i) => ({
          ...campo,
          grupo_id: bloco.grupo?.id ?? null,
          posicao: i,
        }))
      )
    );

    // Manda TODOS os blocos, não só os dois que mudaram: as posições do banco
    // não são densas (campo novo nasce nulo, o semeador cria dez de uma vez),
    // e normalizar tudo a cada arrastar é o que impede o buraco de reaparecer
    // como ordem errada depois.
    const { error } = await supabase.rpc('cb_ordenar_campos_personalizados', {
      p_campos: novos.flatMap((bloco) =>
        posicoesDoBloco(bloco.campos, bloco.grupo?.id ?? null)
      ),
    });
    if (error) {
      setFields(anterior);
      toast.error(t('toastReorderFailed'));
      return;
    }
    // A verdade do banco por cima do otimista (iguais, se tudo correu bem) —
    // e é isto que recupera o que uma busca descartada teria trazido, como
    // uma exclusão feita instantes antes do arrastar.
    await fetchFields();
  }

  async function reordenarGrupos(grupoId: string, alvoId: string) {
    // Mesma cerca de `reordenarCampos` — este é o outro escritor que manda a
    // conta inteira de uma vez.
    if (!catalogoConfiavel) return;
    const ordenados = ordenarGrupos(grupos);
    const de = ordenados.findIndex((g) => g.id === grupoId);
    const para = ordenados.findIndex((g) => g.id === alvoId);
    if (de < 0 || para < 0) return;

    const nova = arrayMove(ordenados, de, para);
    invalidarBuscasEmVoo();
    const anterior = grupos;
    // ⚠️ `i + 1`, ESPELHANDO a RPC (#31 do plano 31/08): o
    // `cb_ordenar_grupos_de_campos` grava a ORDINALITY (1..N), e o estado
    // otimista gravava 0..N-1 — sem refetch depois do arrastar, o
    // `max+1` do handleCreateGrupo calculava sobre a base errada e o bloco
    // novo EMPATAVA com o último (o desempate por nome o punha antes,
    // gravado; um F5 mantinha a ordem errada).
    setGrupos(nova.map((g, i) => ({ ...g, posicao: i + 1 })));

    const { error } = await supabase.rpc('cb_ordenar_grupos_de_campos', {
      p_ids: nova.map((g) => g.id),
    });
    if (error) {
      setGrupos(anterior);
      toast.error(t('toastReorderFailed'));
      return;
    }
    await fetchFields();
  }

  return (
    <div className="space-y-4">
      {/* Create */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              // A sugestão segue o nome só até o operador mexer na chave.
              if (!keyTouched) setNewKey(gerarChaveDeCampo(e.target.value));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreate();
              }
            }}
            placeholder={t('fieldName')}
            className="bg-muted text-foreground"
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="border-border bg-muted text-foreground shrink-0 rounded-md border px-2 py-2 text-sm"
            aria-label={t('fieldType')}
          >
            <option value="text">{t('typeText')}</option>
            <option value={TIPO_DATA}>{t('typeDate')}</option>
            <option value="select">{t('typeSelect')}</option>
            <option value="number">{t('typeNumber')}</option>
          </select>
          <select
            value={grupoEscolhido}
            onChange={(e) => setNewGrupoId(e.target.value)}
            className="border-border bg-muted text-foreground max-w-[9rem] shrink-0 rounded-md border px-2 py-2 text-sm"
            aria-label={t('group')}
          >
            <option value="">{t('groupGeneral')}</option>
            {ordenarGrupos(grupos).map((g) => (
              <option key={g.id} value={g.id}>
                {g.nome}
              </option>
            ))}
          </select>
          <Button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {t('addField')}
          </Button>
        </div>

        {/* O identificador (948) — o que a API usa para achar o campo.
            Sempre visível na criação: se ficasse escondido, o operador só
            descobriria a chave gerada depois, quando renomeá-la já não dá. */}
        {newName.trim() !== '' && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground shrink-0 text-xs">
              {t('fieldKey')}
            </span>
            <Input
              value={newKey}
              onChange={(e) => {
                setKeyTouched(true);
                setNewKey(e.target.value);
              }}
              onBlur={() => setNewKey(gerarChaveDeCampo(newKey))}
              placeholder={t('fieldKeyPlaceholder')}
              className="bg-muted text-foreground h-8 font-mono text-xs"
            />
          </div>
        )}

        {newType === 'select' && (
          <Input
            value={newOptions}
            onChange={(e) => setNewOptions(e.target.value)}
            placeholder={t('optionsPlaceholder')}
            aria-label={t('optionsLabel')}
            className="bg-muted text-foreground"
          />
        )}
      </div>

      {/* ⚠️ Criar bloco fica ACIMA da lista, não abaixo.
          A primeira versão punha este formulário no rodapé do cartão, depois
          de uma lista de 538px — e o operador simplesmente não achou ("não
          achei as possibilidades de criar os grupos"). O cartão já começa
          abaixo da dobra: o que fica no fim dele está a duas rolagens de
          distância de quem acabou de chegar. */}
      <div className="flex items-center gap-2">
        <Input
          value={novoGrupo}
          onChange={(e) => setNovoGrupo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleCreateGrupo();
            }
          }}
          placeholder={t('newGroup')}
          className="bg-muted text-foreground h-9"
        />
        <Button
          variant="outline"
          onClick={handleCreateGrupo}
          disabled={criandoGrupo || !novoGrupo.trim()}
          className="shrink-0"
        >
          {criandoGrupo ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          {t('addGroup')}
        </Button>
      </div>

      <p className="text-muted-foreground px-1 text-xs">{t('reorderHint')}</p>

      {/* List */}
      <div
        className={`border-border overflow-y-auto rounded-md border ${alturaDaLista}`}
      >
        {loading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t('loading')}
          </div>
        ) : !catalogoConfiavel ? (
          /* ⚠️ Carga que falhou NÃO vira "catálogo vazio" (§8.3 do plano):
             afirmar "nenhum campo ainda" sobre consulta falha é a metade de
             exibição do mesmo defeito que o arrastar persistia. Sem lista na
             tela, não há arrastar nem seletor de bloco para gravar coisa
             errada. */
          <div className="text-muted-foreground flex flex-col items-center gap-3 py-8 text-sm">
            <p>{t('loadError')}</p>
            <Button variant="outline" size="sm" onClick={() => void fetchFields()}>
              {t('retry')}
            </Button>
          </div>
        ) : /* ⚠️ O teste é o CATÁLOGO vazio, não `blocos.length`: aqui o
               bloco Geral é incondicional (é o destino de volta do seletor),
               então `blocos` nunca fica vazio e a conta recém-criada veria um
               cabeçalho "Geral" solto em vez da frase que explica a tela. */
          fields.length === 0 && grupos.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            {t('empty')}
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            {/* ⚠️ O bloco Geral fica FORA do `SortableContext` dos grupos: ele
                não tem linha no banco (é o `grupo_id` nulo) e é sempre o
                primeiro, então não há posição para gravar nem alça para
                arrastar. */}
            {blocos
              .filter((b) => b.grupo === null)
              .map((bloco) => (
                <Bloco
                  key="geral"
                  bloco={bloco}
                  grupos={ordenarGrupos(grupos)}
                  titulo={t('groupGeneral')}
                  busyId={busyId}
                  onRename={handleRename}
                  onSaveOptions={handleSaveOptions}
                  onDelete={handleDelete}
                  onMoverParaBloco={moverParaBloco}
                />
              ))}
            <SortableContext
              items={blocos
                .filter((b) => b.grupo !== null)
                .map((b) => `${PREFIXO_GRUPO}${b.grupo!.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {blocos
                .filter((b) => b.grupo !== null)
                .map((bloco) => (
                  <BlocoArrastavel
                    key={bloco.grupo!.id}
                    bloco={bloco}
                    grupos={ordenarGrupos(grupos)}
                    busy={busyId === bloco.grupo!.id}
                    busyId={busyId}
                    onRenameGrupo={handleRenameGrupo}
                    onDeleteGrupo={handleDeleteGrupo}
                    onRename={handleRename}
                    onSaveOptions={handleSaveOptions}
                    onDelete={handleDelete}
                    onMoverParaBloco={moverParaBloco}
                  />
                ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Só aparece quando falta algum: numa conta que já tem os dez, um botão
          permanente de "criar campos de traqueamento" seria um convite a
          clicar e não entender por que nada acontece. */}
      {faltantes.length > 0 && (
        <Button
          variant="outline"
          onClick={handleSeed}
          disabled={semeando}
          className="w-full"
        >
          {semeando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          {t('seedTracking', {
            count: faltantes.length,
            group: nomeDoBlocoNovo,
          })}
        </Button>
      )}
    </div>
  );
}

/** Um bloco: cabeçalho + os campos dele, com a área inteira servindo de alvo
 *  de soltura. O droppable é o que faz um bloco VAZIO aceitar campo — sem ele
 *  um bloco recém-criado não teria como receber o primeiro. */
function Bloco({
  bloco,
  grupos,
  titulo,
  cabecalho,
  busyId,
  onRename,
  onSaveOptions,
  onDelete,
  onMoverParaBloco,
}: {
  bloco: BlocoDeCampos;
  grupos: GrupoDeCampos[];
  titulo?: string;
  cabecalho?: React.ReactNode;
  busyId: string | null;
  onRename: (field: CustomField, name: string) => Promise<boolean>;
  onSaveOptions: (field: CustomField, texto: string) => Promise<boolean>;
  onDelete: (field: CustomField) => void;
  onMoverParaBloco: (field: CustomField, grupoId: string | null) => void;
}) {
  const t = useTranslations('Contacts.customFields');
  const chave = chaveDoBloco(bloco.grupo?.id ?? null);
  const { setNodeRef, isOver } = useDroppable({ id: `${PREFIXO_BLOCO}${chave}` });

  return (
    <div
      ref={setNodeRef}
      className={`border-border border-b last:border-b-0 ${isOver ? 'bg-muted/60' : ''}`}
    >
      {cabecalho ?? (
        <div className="text-muted-foreground bg-muted/30 px-3 py-1.5 text-[11px] font-medium tracking-wider uppercase">
          {titulo}
        </div>
      )}
      {bloco.campos.length === 0 ? (
        <p className="text-muted-foreground px-3 py-4 text-center text-xs">
          {t('emptyGroup')}
        </p>
      ) : (
        <SortableContext
          items={bloco.campos.map((c) => `${PREFIXO_CAMPO}${c.id}`)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="divide-border divide-y">
            {bloco.campos.map((field) => (
              <FieldRow
                key={field.id}
                field={field}
                // ⚠️ SÓ o `busyId` do próprio campo. Herdar o `busy` do bloco
                // punha um spinner no lugar da lixeira de TODAS as linhas
                // enquanto o cabeçalho do bloco salvava um renomeio — dez
                // campos parecendo estar salvando algo que não os envolve.
                busy={busyId === field.id}
                grupos={grupos}
                onRename={onRename}
                onSaveOptions={onSaveOptions}
                onDelete={onDelete}
                onMoverParaBloco={onMoverParaBloco}
              />
            ))}
          </ul>
        </SortableContext>
      )}
    </div>
  );
}

/** O bloco de um grupo de verdade: mesmo corpo, mais alça, renomeio e
 *  exclusão no cabeçalho. */
function BlocoArrastavel({
  bloco,
  busy,
  busyId,
  onRenameGrupo,
  onDeleteGrupo,
  ...resto
}: {
  bloco: BlocoDeCampos;
  busy: boolean;
  busyId: string | null;
  grupos: GrupoDeCampos[];
  onRenameGrupo: (grupo: GrupoDeCampos, nome: string) => Promise<boolean>;
  onDeleteGrupo: (grupo: GrupoDeCampos) => void;
  onRename: (field: CustomField, name: string) => Promise<boolean>;
  onSaveOptions: (field: CustomField, texto: string) => Promise<boolean>;
  onDelete: (field: CustomField) => void;
  onMoverParaBloco: (field: CustomField, grupoId: string | null) => void;
}) {
  const t = useTranslations('Contacts.customFields');
  const grupo = bloco.grupo!;
  const [nome, setNome] = useState(grupo.nome);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `${PREFIXO_GRUPO}${grupo.id}` });

  async function commit() {
    if (nome.trim() === grupo.nome) {
      setNome(grupo.nome);
      return;
    }
    const ok = await onRenameGrupo(grupo, nome);
    if (!ok) setNome(grupo.nome);
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <Bloco
        {...resto}
        bloco={bloco}
        busyId={busyId}
        cabecalho={
          <div className="bg-muted/30 flex items-center gap-1 px-2 py-1">
            {/* ⚠️ Mesma área de toque da alça do campo, e com folga (`p-1`).
                A primeira versão usava `size-3.5` num cabeçalho `py-1`: um
                alvo de 14px que o ponteiro erra por um pixel e o bloco
                simplesmente não é agarrado — sem nada na tela dizendo que o
                gesto falhou. Pego no teste, arrastando pela captura. */}
            <button
              type="button"
              {...attributes}
              {...listeners}
              className="text-muted-foreground hover:text-foreground -m-1 shrink-0 cursor-grab touch-none p-1 active:cursor-grabbing"
              aria-label={t('dragGroupToReorder')}
            >
              <GripVertical className="size-4" />
            </button>
            <Input
              value={nome}
              disabled={busy}
              onChange={(e) => setNome(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              aria-label={t('renameGroupAria', { name: grupo.nome })}
              className="focus:border-primary text-foreground hover:border-border h-7 border-transparent bg-transparent text-[11px] font-medium tracking-wider uppercase"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              onClick={() => onDeleteGrupo(grupo)}
              title={t('deleteGroupTitle')}
              className="text-muted-foreground shrink-0 hover:text-red-400"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </Button>
          </div>
        }
      />
    </div>
  );
}

/** A single editable row. Controlled local state lets us commit on blur /
 *  Enter and cleanly revert to the last saved name when a rename fails. */
function FieldRow({
  field,
  grupos,
  busy,
  onRename,
  onSaveOptions,
  onDelete,
  onMoverParaBloco,
}: {
  field: CustomField;
  grupos: GrupoDeCampos[];
  busy: boolean;
  onRename: (field: CustomField, name: string) => Promise<boolean>;
  onSaveOptions: (field: CustomField, texto: string) => Promise<boolean>;
  onDelete: (field: CustomField) => void;
  onMoverParaBloco: (field: CustomField, grupoId: string | null) => void;
}) {
  const t = useTranslations('Contacts.customFields');
  const [name, setName] = useState(field.field_name);
  const [opcoes, setOpcoes] = useState(opcoesDoCampo(field).join(', '));
  const [copied, setCopied] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `${PREFIXO_CAMPO}${field.id}` });

  async function commit() {
    if (name.trim() === field.field_name) {
      setName(field.field_name); // normalise any whitespace-only edit
      return;
    }
    const ok = await onRename(field, name);
    if (!ok) setName(field.field_name);
  }

  async function commitOpcoes() {
    const atual = opcoesDoCampo(field).join(', ');
    if (opcoes.trim() === atual) {
      setOpcoes(atual);
      return;
    }
    const ok = await onSaveOptions(field, opcoes);
    if (!ok) setOpcoes(atual);
  }

  async function copiarChave() {
    await navigator.clipboard.writeText(field.field_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="bg-card px-2 py-2"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="text-muted-foreground hover:text-foreground shrink-0 cursor-grab touch-none active:cursor-grabbing"
          aria-label={t('dragToReorder')}
        >
          <GripVertical className="size-4" />
        </button>
        <Input
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label={t('renameAria', { name: field.field_name })}
          className="focus:border-primary text-foreground hover:border-border h-8 border-transparent bg-transparent"
        />
        {/* O campo que espelha o e-mail da ficha (1000) não se apaga: no lugar
            da lixeira, um cadeado que diz por quê. Mover e renomear seguem. */}
        {field.espelho ? (
          <span
            title={t('espelhoTitulo')}
            aria-label={t('espelhoTitulo')}
            className="text-muted-foreground flex size-8 shrink-0 items-center justify-center"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Lock className="size-4" />
            )}
          </span>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            onClick={() => onDelete(field)}
            title={t('deleteTitle')}
            className="text-muted-foreground shrink-0 hover:text-red-400"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
          </Button>
        )}
      </div>

      {field.espelho && (
        <p className="text-muted-foreground mt-0.5 pl-6 text-[11px]">
          {t('espelhoDescricao')}
        </p>
      )}

      <div className="mt-0.5 flex items-center gap-2 pl-6">
        {/* A chave (948): imutável depois de criada — renomear o CAMPO não a
            muda, de propósito, senão toda integração externa quebraria a cada
            renomeio cosmético. O botão copia para colar na API. */}
        <button
          type="button"
          onClick={copiarChave}
          title={t('copyKeyTitle')}
          className="text-muted-foreground hover:text-foreground flex min-w-0 flex-1 items-center gap-1 font-mono text-[11px] transition-colors"
        >
          {/* truncate: chave pode ter 60 chars e o diálogo ~390px úteis —
              sem isto a lista inteira ganhava rolagem horizontal. */}
          <span className="min-w-0 truncate">{field.field_key}</span>
          {copied ? (
            <Check className="text-primary size-3" />
          ) : (
            <Copy className="size-3" />
          )}
        </button>

        {/* ⚠️ O bloco do campo, EXPLÍCITO. Arrastar continua funcionando e é
            mais rápido para quem já sabe — mas era o ÚNICO caminho, e o
            operador não o encontrou ("nem de colocar campos já criados em
            outros grupos"). Gesto que ninguém descobre sozinho não pode ser a
            única porta para a metade da funcionalidade. */}
        <select
          value={field.grupo_id ?? ''}
          disabled={busy}
          onChange={(e) => onMoverParaBloco(field, e.target.value || null)}
          aria-label={t('moveToGroup', { name: field.field_name })}
          className="border-border bg-muted text-muted-foreground max-w-[8rem] shrink-0 rounded border px-1 py-0.5 text-[11px]"
        >
          <option value="">{t('groupGeneral')}</option>
          {grupos.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nome}
            </option>
          ))}
        </select>
      </div>

      {field.field_type === 'select' && (
        <Input
          value={opcoes}
          disabled={busy}
          onChange={(e) => setOpcoes(e.target.value)}
          onBlur={commitOpcoes}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label={t('optionsLabel')}
          placeholder={t('optionsPlaceholder')}
          className="bg-muted text-foreground mt-1 ml-6 h-8 text-xs"
        />
      )}
    </li>
  );
}
