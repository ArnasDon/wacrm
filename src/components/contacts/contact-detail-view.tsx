'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { funilNoEscopo } from '@/lib/perfis/escopo';
import { useChannels } from '@/hooks/use-channels';
import { metaChannels, preferredChannel } from '@/lib/cb-channels/display';
import { ChannelSelect } from '@/components/channels/channel-select';
import { ActivityHistory } from '@/components/lead-events/activity-history';
import { ContactTasks } from '@/components/tasks/contact-tasks';
import { formatCurrency } from '@/lib/currency';
import { salvarValoresDoContato } from '@/lib/contacts/custom-values';
import {
  agruparCampos,
  chaveDoBloco,
} from '@/lib/contacts/grupos-de-campos';
import { CampoComSalvamento } from '@/components/contacts/campo-com-salvamento';
import { MenuDeBlocos } from '@/components/contacts/menu-de-blocos';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag, ConversationNote, CustomField, ContactCustomValue, Deal, GrupoDeCampos, MessageTemplate } from "@/types";
import {
  TemplatePicker,
  type TemplateSendValues,
} from '@/components/inbox/template-picker';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ReunioesDoContato } from '@/components/agenda/reunioes-do-contato';
import { ReunioesTranscritasDoContato } from '@/components/transcricoes/reunioes-transcritas-do-contato';
import { AbaCobrancas } from '@/components/inbox/painel/aba-cobrancas';
import { useCobrancasDoContato } from '@/hooks/use-cobrancas-do-contato';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Phone,
  Mail,
  Building2,
  Copy,
  Check,
  Loader2,
  Plus,
  Trash2,
  Save,
  X,
  DollarSign,
  LayoutTemplate,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { identidadeDoContato } from '@/lib/contacts/identidade';
import { campoDoEmail, emailMudou, emailNormalizado } from '@/lib/contacts/email-espelhado';
import { escritaDoNomeManual } from '@/lib/contacts/nome-fixado';

interface ContactDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  onUpdated: () => void;
}

export function ContactDetailView({
  open,
  onOpenChange,
  contactId,
  onUpdated,
}: ContactDetailViewProps) {
  const t = useTranslations('Contacts.detailView');
  /** Só para o rótulo do bloco Geral (966) — o mesmo nome que o catálogo e o
   *  painel da conversa usam. */
  const tCampos = useTranslations('Contacts.customFields');
  const tEventos = useTranslations('LeadEvents');
  const tAgenda = useTranslations('Agenda');
  // Mesmo namespace do fio: a frase "{autor} anotou:" é a MESMA nas quatro
  // telas que mostram anotação, e uma segunda chave divergiria na tradução.
  const tNote = useTranslations('Inbox.note');
  const supabase = createClient();
  // `accountId` saiu com o insert direto: a anotação agora nasce na rota,
  // que resolve a conta no servidor a partir da sessão.
  const { acesso } = useAuth();

  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);
  // As cobranças do Asaas (Fase 1b) — a MESMA aba do painel da conversa.
  // Só busca com a ficha aberta: fechada, `contactId` é o do último aberto
  // e uma leitura ali seria tráfego para ninguém.
  const cobrancas = useCobrancasDoContato(open ? contactId : null);

  // Send template — lets the business initiate (or re-open) a conversation
  // with this contact by sending an approved template. The send route
  // find-or-creates the conversation, so no inbound message is required.
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);

  // PRIMEIRO CONTATO pela ficha: fora de uma conversa existente não há canal
  // a seguir, então antes disto o envio saía sempre pelo padrão da conta —
  // sem escolha e sem aviso. Só canais Meta: primeiro contato é por modelo,
  // e modelo é conceito da API oficial.
  const { channels } = useChannels();
  const canaisMeta = useMemo(() => metaChannels(channels), [channels]);
  const [canalEnvio, setCanalEnvio] = useState<string | null>(null);
  useEffect(() => {
    if (canalEnvio || canaisMeta.length === 0) return;
    const escolha = preferredChannel(canaisMeta);
    if (escolha) setCanalEnvio(escolha.id);
  }, [canaisMeta, canalEnvio]);

  /**
   * ⚠️ Esta ficha e o painel da conversa escrevem O MESMO dado, e só o
   * painel gateava. Sem isto, um `viewer` clicava em "Salvar alterações", a
   * policy `contacts_update` (agent+) casava ZERO linhas, o PostgREST devolvia
   * `error` nulo — e a tela dava toast de sucesso sobre uma escrita que nunca
   * aconteceu. Mesma permissão do painel (`send-messages` = agent+), para as
   * duas superfícies não divergirem.
   */
  const podeEditar = useCan('send-messages');

  // Details tab
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  // Tags tab
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  // Notes tab
  const [notes, setNotes] = useState<ConversationNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Custom fields tab
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  /** Os blocos da 966 — o mesmo catálogo que o painel da conversa lê. */
  const [grupos, setGrupos] = useState<GrupoDeCampos[]>([]);
  /**
   * Bloco à vista no menu horizontal. `null` = ainda não escolhi → o primeiro.
   * Resolvido no render (e não num efeito) para que bloco apagado caia sozinho
   * no primeiro, em vez de deixar a aba vazia com uma pastilha acesa.
   */
  const [blocoAtivo, setBlocoAtivo] = useState<string | null>(null);
  const blocosDaFicha = useMemo(
    () => agruparCampos(customFields, grupos),
    [customFields, grupos]
  );
  const blocoVisivel =
    blocosDaFicha.find(
      (b) => chaveDoBloco(b.grupo?.id ?? null) === blocoAtivo
    ) ?? blocosDaFicha[0];
  const chaveVisivel = blocoVisivel
    ? chaveDoBloco(blocoVisivel.grupo?.id ?? null)
    : null;
  /**
   * ⚠️ Os valores carregam o DONO junto — mesma correção do painel da
   * conversa. Nada limpa `customValues` na troca de contato, então existe um
   * render com o contato NOVO e os valores do ANTERIOR; o campo é montado
   * ali (a `key` já mudou) e semearia o rascunho com o valor do cliente
   * errado. A comparação é contra o PROP do render atual, nunca contra o
   * resultado de um efeito que talvez já tenha rodado.
   */
  const [customValues, setCustomValues] = useState<{
    de: string | null;
    mapa: Record<string, string>;
  }>({ de: null, mapa: {} });

  /**
   * Os valores personalizados, mas SÓ se já forem deste contato — ver o
   * comentário do estado. `null` segura a montagem dos campos.
   */
  const valoresDesteContato =
    customValues.de === contactId ? customValues.mapa : null;
  const [loadingCustom, setLoadingCustom] = useState(false);
  // ⚠️ Falha da carga NÃO pode ficar indistinguível de "carregando" (#17 do
  // plano 31/08): com o erro engolido, `valoresDesteContato` nunca resolvia
  // e a aba girava para sempre, sem toast nem retry — só fechar e reabrir o
  // Sheet. O painel da conversa, que faz o MESMO trio, avisa; as duas telas
  // editam o mesmo dado e divergiam aqui.
  const [falhouCustom, setFalhouCustom] = useState(false);

  // Deals tab
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);

  /**
   * ⚠️ O contato ABERTO agora — a régua das cinco buscas desta ficha.
   *
   * O painel fica montado entre um contato e outro (o `Sheet` só troca o
   * `contactId`), então respostas de contatos diferentes disputam o mesmo
   * estado: abrir A com a rede lenta, fechar, abrir B, e a resposta de A
   * chega depois e preenche os campos com os dados de A — que o "Salvar
   * alterações" então grava no CONTATO B. O painel da conversa já tinha
   * essa guarda (`contactIdRef`/`dadosProntos`); esta ficha, não.
   */
  const contatoAlvoRef = useRef(contactId);

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    const alvo = contactId;
    setLoading(true);

    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .single();

    if (contatoAlvoRef.current !== alvo) return;
    if (data) {
      setContact(data);
      setEditName(data.name ?? '');
      setEditPhone(data.phone);
      setEditEmail(data.email ?? '');
      setEditCompany(data.company ?? '');
    }
    setLoading(false);
  }, [contactId, supabase]);

  const fetchTags = useCallback(async () => {
    if (!contactId) return;
    const alvo = contactId;

    const [tagsRes, contactTagsRes] = await Promise.all([
      supabase.from('tags').select('*').order('name'),
      supabase.from('contact_tags').select('tag_id').eq('contact_id', contactId),
    ]);

    if (contatoAlvoRef.current !== alvo) return;
    if (tagsRes.data) setAllTags(tagsRes.data);
    if (contactTagsRes.data) {
      setContactTagIds(contactTagsRes.data.map((ct) => ct.tag_id));
    }
  }, [contactId, supabase]);

  const fetchNotes = useCallback(async () => {
    if (!contactId) return;
    const alvo = contactId;
    setLoadingNotes(true);

    // Desde a 918 a anotação vive em `cb_conversation_notes`, chaveada pela
    // CONVERSA. A coluna `contact_id` é desnormalizada exatamente para esta
    // tela, que fica fora do inbox e não tem conversa aberta à mão.
    const { data } = await supabase
      .from('cb_conversation_notes')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (contatoAlvoRef.current !== alvo) return;
    if (data) setNotes(data);
    setLoadingNotes(false);
  }, [contactId, supabase]);

  const fetchCustomFields = useCallback(async () => {
    if (!contactId) return;
    const alvo = contactId;
    setLoadingCustom(true);

    const [fieldsRes, valuesRes, gruposRes] = await Promise.all([
      supabase
        .from('custom_fields')
        .select('*')
        .order('posicao', { nullsFirst: false })
        .order('field_name'),
      supabase
        .from('contact_custom_values')
        .select('*')
        .eq('contact_id', contactId),
      supabase
        .from('cb_grupos_de_campos')
        .select('*')
        .order('posicao')
        .order('nome'),
    ]);

    // ⚠️ O caso mais caro da ficha: sem isto os VALORES de A entram no
    // formulário aberto sobre B, e o Salvar os grava lá.
    if (contatoAlvoRef.current !== alvo) return;
    if (fieldsRes.error || valuesRes.error || gruposRes.error) {
      toast.error(t('customLoadError'));
      setFalhouCustom(true);
      setLoadingCustom(false);
      return;
    }
    setFalhouCustom(false);
    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    // Falhando, `agruparCampos` joga tudo no bloco Geral: a ficha perde a
    // divisão, mas nenhum campo some.
    if (gruposRes.data) setGrupos(gruposRes.data as GrupoDeCampos[]);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues({ de: alvo, mapa: map });
    }
    setLoadingCustom(false);
  }, [contactId, supabase]);

  const fetchDeals = useCallback(async () => {
    if (!contactId) return;
    const alvo = contactId;
    setLoadingDeals(true);
    const { data } = await supabase
      .from('deals')
      .select('*, stage:pipeline_stages(*)')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    if (contatoAlvoRef.current !== alvo) return;
    // Recorte por perfil (Fase 4): a aba Negócios esconde caso de funil de
    // outra área — decisão do operador (cliente pode ter caso no trabalhista
    // E no bancário; cada equipe vê o seu). Órfão de funil passa.
    setDeals(
      ((data ?? []) as Deal[]).filter(
        (d) => !d.pipeline_id || funilNoEscopo(acesso, d.pipeline_id),
      ),
    );
    setLoadingDeals(false);
  }, [contactId, supabase, acesso]);

  useEffect(() => {
    // Aponta o alvo ANTES de disparar: é ele que faz as respostas em voo do
    // contato anterior serem descartadas em vez de preencherem este.
    contatoAlvoRef.current = contactId;
    if (open && contactId) {
      fetchContact();
      fetchTags();
      fetchNotes();
      fetchCustomFields();
      fetchDeals();
    }
  }, [open, contactId, fetchContact, fetchTags, fetchNotes, fetchCustomFields, fetchDeals]);

  async function copyPhone() {
    if (!contact) return;
    const texto = identidadeDoContato(contact);
    if (!texto) return;
    await navigator.clipboard.writeText(texto);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  }

  async function saveDetails() {
    if (!contactId || !editPhone.trim()) {
      toast.error(t('toastPhoneRequired'));
      return;
    }

    setSavingDetails(true);
    // ⚠️ O e-mail só viaja se MUDOU nesta caixa (1000). Ele também é o campo
    // personalizado espelhado, que salva sozinho em outra aba: sem a régua,
    // editar o campo e depois salvar aqui só o telefone regravaria o e-mail
    // que estava na tela — e o gatilho levaria o antigo de volta ao campo.
    const mudouEmail = emailMudou(contact?.email, editEmail);
    const emailNovo = emailNormalizado(editEmail);
    const agora = new Date().toISOString();
    const { error } = await supabase
      .from('contacts')
      .update({
        // O nome (e a marca, 999) só vão quando o NOME mudou: salvar só o
        // e-mail não fixa o nome que veio do WhatsApp, e a ficha aberta antes
        // de um agendamento não devolve o nome antigo por cima do novo.
        ...escritaDoNomeManual(contact?.name, editName, agora),
        phone: editPhone.trim(),
        ...(mudouEmail ? { email: emailNovo } : {}),
        company: editCompany.trim() || null,
        updated_at: agora,
      })
      .eq('id', contactId);

    if (error) {
      toast.error(t('toastUpdateFailed'));
    } else {
      toast.success(t('toastUpdated'));
      // O gatilho já copiou o e-mail para o campo espelhado; a aba de campos
      // desmonta quando inativa e remonta lendo este mapa.
      const espelho = campoDoEmail(customFields);
      if (mudouEmail && espelho) {
        setCustomValues((prev) =>
          prev.de === contactId
            ? { de: prev.de, mapa: { ...prev.mapa, [espelho]: emailNovo ?? '' } }
            : prev
        );
      }
      fetchContact();
      onUpdated();
    }
    setSavingDetails(false);
  }

  async function toggleTag(tagId: string) {
    if (!contactId) return;
    setSavingTags(true);

    const isSelected = contactTagIds.includes(tagId);

    try {
      if (isSelected) {
        await deleteContactTag(contactId, tagId);
        setContactTagIds((prev) => prev.filter((id) => id !== tagId));
      } else {
        await addContactTag(contactId, tagId);
        setContactTagIds((prev) => [...prev, tagId]);
      }
      onUpdated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toastUpdateFailed'));
    }
    setSavingTags(false);
  }

  /**
   * ⚠️ Vai pela ROTA, não por insert direto. `cb_conversation_notes` não tem
   * policy de INSERT e `authenticated` teve o INSERT revogado — o insert
   * direto que existia aqui (na `contact_notes`) daria 42501.
   *
   * Manda o `contact_id`: esta tela vive fora do inbox e não tem conversa
   * aberta. O servidor resolve qual é a conversa daquele contato (uma só, por
   * `idx_conversations_account_contact`) e devolve `CONTACT_WITHOUT_
   * CONVERSATION` quando não há nenhuma — contato cadastrado à mão que nunca
   * trocou mensagem. É a capacidade que se perdeu ao chavear a anotação pela
   * conversa, e o operador precisa ler o motivo em vez de ver um erro seco.
   */
  async function addNote() {
    if (!contactId || !newNote.trim()) return;
    setSavingNote(true);

    try {
      const res = await fetch('/api/cb/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId, texto: newNote.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setNewNote('');
        fetchNotes();
        toast.success(t('toastNoteAdded'));
      } else if (json?.error === 'CONTACT_WITHOUT_CONVERSATION') {
        toast.error(t('toastNoteNeedsConversation'));
      } else {
        toast.error(t('toastNoteAddFailed'));
      }
    } catch {
      toast.error(t('toastNoteAddFailed'));
    } finally {
      setSavingNote(false);
    }
  }

  /**
   * ⚠️ A política de exclusão MUDOU com a 918, e o silêncio é a armadilha.
   *
   * Na `contact_notes` qualquer `agent` apagava qualquer anotação. Na tabela
   * nova a policy é "autor OU admin" — e RLS que barra DELETE não devolve
   * erro: devolve **0 linhas**, que aqui pareceria sucesso. Por isso o
   * `count`: sem ele a anotação sumia da tela, continuava no banco e voltava
   * no próximo carregamento, sem nada explicando.
   */
  async function deleteNote(noteId: string) {
    const { error, count } = await supabase
      .from('cb_conversation_notes')
      .delete({ count: 'exact' })
      .eq('id', noteId);

    if (error) {
      toast.error(t('toastNoteDeleteFailed'));
    } else if (!count) {
      toast.error(t('toastNoteDeleteForbidden'));
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success(t('toastNoteDeleted'));
    }
  }

  /**
   * Grava UM campo personalizado (Fase B1) — não existe mais "Salvar campos".
   *
   * ⚠️ UM campo por gravação, nunca o mapa inteiro: `""` no upsert
   * compartilhado significa DELETE da linha, então um envio do mapa a cada
   * blur faria um campo ainda não carregado apagar dado real.
   *
   * ⚠️ O aviso nomeia o CAMPO e o CLIENTE. Com o botão o erro chegava com o
   * operador olhando a ficha; agora ele pode já ter fechado o painel.
   */
  const gravarCampo = useCallback(
    async (fieldId: string, valor: string): Promise<boolean> => {
      if (!contactId || !podeEditar) return false;
      const erro = await salvarValoresDoContato(supabase, contactId, {
        [fieldId]: valor,
      });
      if (erro) {
        toast.error(
          t('toastCustomFieldFailed', {
            campo:
              customFields.find((f) => f.id === fieldId)?.field_name ?? fieldId,
            cliente: contact?.name || contact?.phone || '',
          })
        );
        return false;
      }
      // Espelha o que o banco guardou (o helper grava aparado).
      setCustomValues((prev) =>
        prev.de === contactId
          ? { de: prev.de, mapa: { ...prev.mapa, [fieldId]: valor.trim() } }
          : prev
      );
      // O campo espelhado (1000): o gatilho já gravou o e-mail da ficha.
      // A caixa da aba de dados e o contato carregado passam a dizer o mesmo
      // — senão o "Salvar" de lá compararia contra o e-mail velho.
      if (fieldId === campoDoEmail(customFields)) {
        const novo = emailNormalizado(valor);
        setEditEmail(novo ?? '');
        setContact((prev) => (prev ? { ...prev, email: novo ?? undefined } : prev));
      }
      return true;
    },
    [contactId, podeEditar, supabase, customFields, contact, t]
  );

  async function handleSendTemplate(
    template: MessageTemplate,
    values: TemplateSendValues,
  ) {
    if (!contactId) return;
    setSendingTemplate(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // No conversation_id — the route find-or-creates one for this
          // contact, mirroring the inbox template-send payload otherwise.
          contact_id: contactId,
          // Fixa a conversa neste número: a resposta do cliente volta pelo
          // mesmo lugar de onde ele viu a mensagem.
          channel_id: canalEnvio,
          message_type: 'template',
          template_name: template.name,
          template_language: template.language,
          template_message_params: {
            body: values.body,
            headerText: values.headerText,
            buttonParams: values.buttonParams,
          },
          template_params: values.body,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = payload?.error || `HTTP ${res.status}`;
        toast.error(t('toastTemplateFailed', { reason }));
        return;
      }

      toast.success(t('toastTemplateSent', { name: template.name }));
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'network error';
      toast.error(`Failed to send template: ${reason}`);
    } finally {
      setSendingTemplate(false);
    }
  }

  function getInitials(name?: string | null) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* ⚠️ A LARGURA TAMBÉM PRECISA DO PREFIXO DE VARIANTE — mesma armadilha
          das abas, algumas linhas abaixo. O `sheet.tsx` traz
          `data-[side=right]:w-3/4` e `data-[side=right]:sm:max-w-sm`; um
          `sm:max-w-lg` cru não desempata no tailwind-merge (prefixos
          diferentes) e ainda PERDE por especificidade, porque a classe do
          primitivo carrega o seletor de atributo. Resultado medido: o painel
          abria com 384px em vez dos 512px pedidos aqui — e é essa largura a
          MENOR que obriga as 8 abas a quebrar em 3 linhas.

          ⚠️ Só o `max-w`, e o `w-full` que estava aqui FOI EMBORA de
          propósito: prefixado, ele venceria o `w-3/4` do primitivo e o painel
          viraria tela cheia abaixo de `sm` — sem sobrar fundo para fechar
          tocando fora. Com `w-3/4` o celular mantém a saída (medido: 281px de
          painel em 375px de tela) e o desktop dá os mesmos 512px, porque 3/4
          de 1440 estoura o teto de qualquer jeito. */}
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground data-[side=right]:sm:max-w-lg p-0"
      >
        {loading || !contact ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Header */}
            <SheetHeader className="p-4 border-b border-border/50">
              <div className="flex items-center gap-3">
                <Avatar className="size-12 bg-muted border border-border">
                  <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                    {getInitials(contact.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-popover-foreground truncate">
                    {contact.name || t('unnamed')}
                  </SheetTitle>
                  <SheetDescription className="text-muted-foreground text-xs mt-0.5">
                    {t('contactDetailsDesc')}
                  </SheetDescription>
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                    <button
                      onClick={copyPhone}
                      className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                    >
                      <Phone className="size-3" />
                      {identidadeDoContato(contact)}
                      {copiedPhone ? (
                        <Check className="size-3 text-primary" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                    {contact.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="size-3" />
                        {contact.email}
                      </span>
                    )}
                    {contact.company && (
                      <span className="flex items-center gap-1">
                        <Building2 className="size-3" />
                        {contact.company}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => setTemplatePickerOpen(true)}
                  disabled={sendingTemplate}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {sendingTemplate ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <LayoutTemplate className="size-4" />
                  )}
                  {t('sendTemplateBtn')}
                </Button>
                {canaisMeta.length >= 2 && (
                  <ChannelSelect
                    channels={canaisMeta}
                    value={canalEnvio}
                    onChange={setCanalEnvio}
                    className="h-8 w-44"
                  />
                )}
              </div>
            </SheetHeader>

            {/* Tabs */}
            <Tabs defaultValue="details" className="flex-1 flex flex-col min-h-0">
              {/* `flex-wrap h-auto`: com 5 abas a lista JÁ estourava a largura
                  do painel e cortava "Campos personalizados" pela metade; a
                  aba de Histórico levaria "Negócios" junto para fora de vista.
                  Quebrar em duas linhas mostra todas — a barra rolar
                  horizontalmente esconderia abas sem nenhuma pista de que
                  existem.

                  ⚠️ `[&>button]:flex-none` é local, e não uma mudança no
                  `TabsTrigger` (que ~20 telas usam). O `flex-1` do componente
                  faz cada aba dividir a linha em partes iguais — ótimo com 3
                  por linha, ruim quando a sétima sobra sozinha: ela esticava
                  por toda a largura e passava a parecer um cabeçalho de seção,
                  não uma aba. Com largura natural elas se acomodam sem sobra.

                  ⚠️⚠️ A ALTURA PRECISA DO PREFIXO DE VARIANTE. `h-auto` cru
                  NÃO desliga o `group-data-horizontal/tabs:h-8` do `TabsList`:
                  o tailwind-merge só desempata classes com o MESMO prefixo, e
                  como os prefixos diferem as duas sobrevivem — a variante
                  vence (o `Tabs` sempre carimba `data-orientation`) e a lista
                  fica travada em 32px. Com `flex-wrap` e 8 abas isso punha as
                  linhas 2 e 3 POR CIMA do conteúdo do painel: as abas cobriam
                  os campos personalizados. Medido com o twMerge do projeto:
                  `twMerge('group-data-horizontal/tabs:h-8 h-auto')` devolve as
                  DUAS; com o prefixo, devolve só a nossa. Se alguém "limpar"
                  este prefixo achando-o redundante, a tela quebra de novo.

                  ⚠️ `[&>button]:h-auto` é LOAD-BEARING, não enfeite: o
                  `h-[calc(100%-1px)]` do `TabsTrigger` pede 100% da altura da
                  LISTA, e agora que ela é automática cada aba pede TODAS as
                  linhas para si. Medido no app com o override removido (lista
                  de 73px, duas linhas): a aba de 30px vira 63px, a lista
                  transborda 61px e as abas voltam a cobrir o painel — o mesmo
                  defeito, por outro caminho, e ele PIORA a cada linha que a
                  lista ganhar. `gap-y-1`/`py-1` aí sim são só respiro. */}
              <TabsList className="bg-muted/50 border-b border-border mx-4 mt-3 flex-wrap group-data-horizontal/tabs:h-auto justify-start gap-x-1 gap-y-1 py-1 [&>button]:flex-none [&>button]:h-auto [&>button]:py-1">
                <TabsTrigger
                  value="details"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.details')}
                </TabsTrigger>
                <TabsTrigger
                  value="tags"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.tags')}
                </TabsTrigger>
                <TabsTrigger
                  value="notes"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.notes')}
                </TabsTrigger>
                <TabsTrigger
                  value="custom"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.custom')}
                </TabsTrigger>
                <TabsTrigger
                  value="deals"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.deals')}
                </TabsTrigger>
                <TabsTrigger
                  value="tasks"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.tasks')}
                </TabsTrigger>
                <TabsTrigger
                  value="meetings"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {tAgenda('reunioesDoCliente')}
                </TabsTrigger>
                {/* Só com o Asaas conectado (sinal da conta, guardado pelo
                    hook) — a mesma regra da aba do painel da conversa. */}
                {cobrancas.conectado !== false && (
                  <TabsTrigger
                    value="billing"
                    className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                  >
                    {t('tabs.billing')}
                  </TabsTrigger>
                )}
                <TabsTrigger
                  value="history"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {tEventos('title')}
                </TabsTrigger>
              </TabsList>

              {/* Details Tab */}
              <TabsContent value="details" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">{t('name')}</Label>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">
                      {t('phone')} <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">{t('email')}</Label>
                    <Input
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">{t('company')}</Label>
                    <Input
                      value={editCompany}
                      onChange={(e) => setEditCompany(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <Button
                    onClick={saveDetails}
                    disabled={savingDetails || !podeEditar}
                    title={podeEditar ? undefined : t('readOnlyHint')}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                    size="sm"
                  >
                    {savingDetails ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    {t('saveChangesBtn')}
                  </Button>
                </div>
              </TabsContent>

              {/* Tags Tab */}
              <TabsContent value="tags" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {t('tagsTab.clickTagDesc')}
                  </p>
                  {allTags.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('tagsTab.noTagsAvailable')}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {allTags.map((tag) => {
                        const selected = contactTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            onClick={() => toggleTag(tag.id)}
                            disabled={savingTags}
                            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                              selected
                                ? 'ring-2 ring-primary ring-offset-1 ring-offset-border'
                                : 'opacity-50 hover:opacity-80'
                            }`}
                            style={{
                              backgroundColor: tag.color + '20',
                              color: tag.color,
                            }}
                          >
                            {selected && <Check className="size-3 mr-1" />}
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Notes Tab */}
              <TabsContent value="notes" className="flex-1 flex flex-col min-h-0 px-4 py-3">
                <div className="space-y-2 mb-3">
                  <Textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder={t('notesTab.placeholder')}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-[60px] text-sm resize-none"
                  />
                  <Button
                    onClick={addNote}
                    disabled={!newNote.trim() || savingNote}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    size="sm"
                  >
                    {savingNote ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Plus className="size-3.5" />
                    )}
                    {t('notesTab.save')}
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2">
                  {loadingNotes ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : notes.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      {t('notesTab.noNotes')}
                    </p>
                  ) : (
                    notes.map((note) => (
                      <div
                        key={note.id}
                        className="rounded-lg bg-muted/50 border border-border/50 p-3 group"
                      >
                        {/* Autor, igual ao fio e às abas do inbox: a mesma
                            anotação não pode ter dono numa tela e ser anônima
                            na outra. Queda para "Alguém da equipe" quando o
                            autor saiu da conta (`autor_nome` congelado). */}
                        <p className="text-foreground mb-1 text-[11px] font-semibold">
                          {tNote('wrote', {
                            autor: note.autor_nome || tNote('unknownAuthor'),
                          })}
                        </p>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap flex-1">
                            {note.texto}
                          </p>
                          <button
                            onClick={() => deleteNote(note.id)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all cursor-pointer shrink-0"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1.5">
                          {new Date(note.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>

              {/* Custom Fields Tab */}
              <TabsContent value="custom" className="flex-1 overflow-y-auto px-4 py-3">
                {falhouCustom ? (
                  <div className="flex flex-col items-center gap-2 py-8">
                    <p className="text-sm text-muted-foreground">
                      {t('customLoadError')}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void fetchCustomFields()}
                    >
                      {t('customRetry')}
                    </Button>
                  </div>
                ) : loadingCustom || !valoresDesteContato ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : customFields.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {t('noCustomFields')}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {/* ⚠️ Menu horizontal, igual ao painel da conversa (966):
                        só o bloco escolhido aparece. Empilhar os blocos
                        organizava sem reduzir nada — os 15 campos continuavam
                        todos na tela. Some com menos de dois blocos. */}
                    <MenuDeBlocos
                      blocos={blocosDaFicha}
                      chaveVisivel={chaveVisivel}
                      onEscolher={setBlocoAtivo}
                      rotuloDoGeral={tCampos('groupGeneral')}
                    />
                    {/* ⚠️ A `key` INCLUI o contato — ver o cabeçalho do
                        `CampoComSalvamento`: sem ela o React reusa a
                        instância ao trocar de cliente e a descarga de
                        desmonte grava no cliente errado. Mesma peça do
                        painel da conversa: as duas telas editam o MESMO
                        dado, e uma com botão e outra sem divergiria no
                        primeiro tipo de campo novo. */}
                    {blocoVisivel?.campos.map((field) => (
                      <CampoComSalvamento
                        key={`${contactId}:${field.id}`}
                        field={field}
                        rotulo={field.field_name}
                        valorSalvo={valoresDesteContato[field.id] ?? ''}
                        aoGravar={gravarCampo}
                        textoSalvo={t('fieldSaved')}
                        disabled={!podeEditar}
                        placeholder={t('enterCustomField', { name: field.field_name })}
                        className="space-y-1.5"
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Deals Tab */}
              <TabsContent value="deals" className="flex-1 overflow-y-auto px-4 py-3">
                {loadingDeals ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-primary" />
                  </div>
                ) : deals.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('dealsTab.noDeals')}</p>
                ) : (
                  <div className="space-y-2">
                    {deals.map((deal) => (
                      <div
                        key={deal.id}
                        className="rounded-lg border border-border bg-muted/50 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {deal.title}
                          </p>
                          {deal.stage && (
                            <span
                              className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: `${deal.stage.color}20`,
                                color: deal.stage.color,
                              }}
                            >
                              {deal.stage.name}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <DollarSign className="size-3" />
                            {formatCurrency(deal.value)}
                          </span>
                          {deal.status && deal.status !== 'open' && (
                            <span
                              className={
                                deal.status === 'won'
                                  ? 'text-primary'
                                  : 'text-red-400'
                              }
                            >
                              {deal.status}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Tarefas (944) — o que falta fazer com este cliente. Fica ANTES
                  do Histórico de propósito: as duas são listas cronológicas e
                  parecidas de longe, mas uma olha para a frente e a outra para
                  trás, e quem abre a ficha para agir quer a primeira. */}
              <TabsContent value="tasks" className="flex-1 overflow-y-auto px-4 py-3">
                {/* ⚠️ Guardado, e o componente exige `string` de propósito: não
                    existe tarefa sem cliente (`contact_id` é NOT NULL), então
                    aceitar nulo aqui só adiaria o problema para dentro do
                    formulário, onde ele viraria um POST recusado. */}
                {contactId ? <ContactTasks contactId={contactId} semTitulo /> : null}
              </TabsContent>

              {/* Histórico — a trilha auditável completa (migration 912).
                  Aba própria em vez de rodapé da aba de Negócios porque ela
                  cobre também as tags, e porque é a tela para onde se vai
                  quando a pergunta é "quem mudou isso, e de quê para quê". */}
              {/* Meetings Tab — Fase 1 da agenda (945) */}
              <TabsContent value="meetings" className="flex-1 overflow-y-auto px-4 py-3">
                <ReunioesDoContato contactId={contact.id} />
                {/* As reuniões TRANSCRITAS (987): o histórico do que foi dito,
                    importado do tl;dv ou colado à mão. Na mesma aba de
                    propósito — a agenda olha para a frente, a transcrição para
                    trás, e as duas são "as reuniões com este cliente". */}
                <div className="mt-4">
                  <ReunioesTranscritasDoContato contactId={contact.id} />
                </div>
              </TabsContent>

              {/* Cobranças (Asaas, Fase 1b): o mesmo componente do painel da
                  conversa — uma tela só para "o que este cliente deve". */}
              <TabsContent value="billing" className="flex-1 overflow-y-auto px-4 py-3">
                <AbaCobrancas
                  dados={cobrancas.dados}
                  carregando={cobrancas.carregando}
                  falhou={cobrancas.falhou}
                  recarregar={cobrancas.recarregar}
                />
              </TabsContent>

              <TabsContent value="history" className="flex-1 overflow-y-auto px-4 py-3">
                <ActivityHistory contactId={contactId} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
    <TemplatePicker
      channelId={canalEnvio}
      open={templatePickerOpen}
      onOpenChange={setTemplatePickerOpen}
      onSelect={handleSendTemplate}
    />
    </>
  );
}
