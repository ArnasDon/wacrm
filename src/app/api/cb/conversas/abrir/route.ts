import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { createClient } from '@/lib/supabase/server'
import { canSendMessages, isAccountRole } from '@/lib/auth/roles'
import { fichaQueVenceu, findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { marcaDoNomeManual } from '@/lib/contacts/nome-fixado'
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { pinConversationChannel } from '@/lib/cb-channels/stamp'

/**
 * Abrir conversa com um número, a partir do CRM.
 *
 * ⚠️ POR QUE ISTO EXISTE. Até 2026-08-31 não havia como o escritório PUXAR
 * uma conversa: ela só aparecia quando o cliente escrevia ou quando alguém
 * mandava mensagem pelo celular pareado — e nesse segundo caso o CRM só
 * ficava sabendo depois, pelo eco do webhook. Quem quisesse abordar um
 * cliente pelo sistema não tinha por onde começar.
 *
 * ⚠️ NÃO ENVIA NADA, e não cria negócio. Abre (ou reencontra) o contato e a
 * conversa, fixa o canal, e devolve o id para a tela navegar até lá — o
 * operador escreve no compositor de sempre. Decisão do operador em
 * 2026-08-31: o card nasce no PRIMEIRO ENVIO, não aqui. Abrir a caixa é
 * barato e reversível; número digitado errado viraria negócio no funil que
 * alguém teria de caçar e apagar à mão. Como o núcleo de envio roteia
 * (`sendMessageToConversation` → `routeContactToPipeline`), a primeira
 * mensagem abre o card sozinha, sem esta rota saber de funil nenhum.
 */

/** Nome opcional; a coluna é `text` e o padrão da tela é o próprio número. */
const MAX_NOME = 200

/** Forma de UUID — o que o Postgres aceita em `uuid`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle()

  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json(
      { error: 'Your profile is not linked to an account.' },
      { status: 403 },
    )
  }

  // Mesmo papel que ENVIAR mensagem, e não o de anotar: abrir conversa é o
  // primeiro passo de falar com um cliente. Um `viewer` que pudesse abrir
  // caixas encheria o inbox da equipe com conversas vazias.
  const papel = profile?.account_role
  if (!isAccountRole(papel) || !canSendMessages(papel)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { telefone, channel_id, nome } = (body ?? {}) as {
    telefone?: unknown
    channel_id?: unknown
    nome?: unknown
  }

  // ---- Telefone ----
  // `isValidE164` aceita 7 a 15 dígitos, e o teto é load-bearing: o
  // `findExistingContact` abaixo casa pelos ÚLTIMOS 8 DÍGITOS, então um JID
  // de grupo (~18 dígitos) colado aqui poderia FUNDIR com o celular de um
  // cliente real e escrever na conversa errada. Grupo tem caminho próprio
  // (`cb_groups`) e não entra por aqui.
  const digitos = sanitizePhoneForMeta(typeof telefone === 'string' ? telefone : '')
  if (!digitos || !isValidE164(digitos)) {
    return NextResponse.json({ error: 'INVALID_PHONE' }, { status: 400 })
  }

  // ---- Canal ----
  // Obrigatório e explícito, mesmo numa conta de um número só. Deixar o
  // servidor escolher o padrão faria a conversa nascer apontando para um
  // número que ninguém decidiu — e é justamente a confusão de identidade que
  // o multi-canal existe para evitar num escritório com Comercial e Jurídico.
  if (typeof channel_id !== 'string' || !UUID.test(channel_id)) {
    return NextResponse.json({ error: 'INVALID_CHANNEL' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  // ⚠️ Confere POSSE (o canal é desta conta), não o ESCOPO DE PERFIL. Não é
  // esquecimento: nenhuma rota deste projeto valida `canalNoEscopo` — o
  // recorte de canal do perfil (956) é de VISIBILIDADE e vive no cliente,
  // e o diálogo já oferece só as conexões visíveis. Inaugurar a validação
  // aqui, sozinha, daria uma garantia que as outras rotas não dão e faria
  // parecer que existe uma barreira onde não existe. Quando o projeto
  // decidir tornar o escopo uma barreira de verdade, ele vira uma passada
  // por TODAS as rotas de escrita, não uma exceção nesta.
  const { data: canal, error: canalErr } = await admin
    .from('cb_channels')
    .select('id')
    .eq('id', channel_id)
    .eq('account_id', accountId)
    .maybeSingle()

  // ⚠️ Erro de banco NÃO é "não encontrado" — a lição da API v1. Um timeout
  // do PostgREST tratado como 404 faria a tela dizer "conexão não existe"
  // sobre uma conexão perfeitamente viva.
  if (canalErr) {
    return NextResponse.json({ error: 'LOOKUP_FAILED' }, { status: 500 })
  }
  if (!canal) {
    return NextResponse.json({ error: 'CHANNEL_NOT_FOUND' }, { status: 404 })
  }

  const nomeLimpo =
    typeof nome === 'string' && nome.trim() ? nome.trim().slice(0, MAX_NOME) : null

  // ---- Dono de registro: o DONO DA CONTA, nunca quem clicou ----
  // ⚠️ NÃO é preciosismo de auditoria — é perda de dados. `contacts.user_id`
  // referencia `auth.users` com **ON DELETE CASCADE**, e
  // `conversations.contact_id` cascateia de novo: gravar aqui o membro que
  // clicou faz com que, no dia em que essa pessoa sair, o CONTATO seja
  // apagado junto, levando a conversa e TODAS as mensagens do cliente — que
  // são do escritório, não dela. A ingestão nunca teve esse problema porque
  // sempre gravou o dono (`configOwnerUserId`).
  //
  // `accounts.owner_user_id` é NOT NULL, então existe sempre que a conta
  // existe; falhar a leitura é erro de verdade, não caso a contornar.
  const { data: conta, error: contaErr } = await admin
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle()

  const donoDaConta = conta?.owner_user_id as string | undefined
  if (contaErr || !donoDaConta) {
    console.error('[conversas/abrir] dono da conta não resolvido:', contaErr)
    return NextResponse.json({ error: 'LOOKUP_FAILED' }, { status: 500 })
  }

  // ---- Contato: reencontra antes de criar ----
  const achado = await resolverContato(admin, accountId, donoDaConta, digitos, nomeLimpo)
  if ('erro' in achado) {
    return NextResponse.json(
      {
        error:
          achado.erro === 'LOOKUP_FAILED' ? 'LOOKUP_FAILED' : 'CONTACT_CREATE_FAILED',
      },
      { status: 500 },
    )
  }

  // ---- Conversa: uma por contato (UNIQUE da 036) ----
  const conversa = await resolverConversa(admin, accountId, donoDaConta, achado.contato.id)
  if ('erro' in conversa) {
    return NextResponse.json(
      {
        error:
          conversa.erro === 'LOOKUP_FAILED'
            ? 'LOOKUP_FAILED'
            : 'CONVERSATION_CREATE_FAILED',
      },
      { status: 500 },
    )
  }
  const conversationId = conversa.id

  // ---- Fixa o canal ----
  // `pin`, não `follow`: quem clicou ESCOLHEU o número, e a escolha tem de
  // sobreviver ao cliente responder por outro. Vale também quando a conversa
  // já existia — abrir de novo escolhendo o Jurídico é dizer "daqui em diante
  // é por aqui". Best-effort: falhar aqui não desfaz a conversa, que é o que
  // o operador pediu; ela só continua respondendo pelo canal anterior.
  await pinConversationChannel(admin, accountId, conversationId, channel_id)

  return NextResponse.json({
    conversation_id: conversationId,
    contact_id: achado.contato.id,
    contact_name: (achado.contato.name as string | null) ?? null,
    criou_contato: achado.criou,
  })
}

/**
 * O contato daquele número nesta conta, criando se ainda não houver.
 *
 * A busca é a MESMA da ingestão (`findExistingContact`), de propósito: ela
 * casa por sufixo com tolerância a prefixo de tronco, e é o que impede o
 * operador de abrir uma ficha paralela ao digitar o número com o nono dígito
 * quando o cliente já existe sem ele — duas fichas para a mesma pessoa, cada
 * uma com metade do histórico.
 */
async function resolverContato(
  admin: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  /** Dono da conta — ver o comentário no chamador (FK com CASCADE). */
  donoDaConta: string,
  digitos: string,
  nomeLimpo: string | null,
): Promise<
  | { contato: { id: string; name?: string | null }; criou: boolean }
  | { erro: 'LOOKUP_FAILED' | 'CREATE_FAILED' }
> {
  const busca = await findExistingContact(admin, accountId, digitos)
  // ⚠️ Erro de banco NÃO é "não encontrado" — a mesma lição do canal e da
  // conta, lá em cima. Seguir criando aqui era o que duplicava a ficha
  // (achado #04): a variante do nono dígito tem `phone_normalized` diferente
  // e passa limpa pelo índice único — duas fichas, cada uma com metade do
  // histórico do cliente.
  if (busca.falhou) return { erro: 'LOOKUP_FAILED' }
  if (busca.contato) return { contato: busca.contato, criou: false }

  const { data: novo, error } = await admin
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: donoDaConta,
      phone: digitos,
      // Sem nome, o número: é o que a ingestão faz, e o que o WhatsApp
      // mostra até alguém batizar o contato.
      name: nomeLimpo || digitos,
      // Nome DIGITADO pelo operador fica fixado (999), como no formulário de
      // contato: sem a marca, a primeira resposta do cliente o trocava pelo
      // perfil do WhatsApp (revisão do PR #208). Sem nome, nada é gravado.
      ...marcaDoNomeManual(null, nomeLimpo, new Date().toISOString()),
    })
    .select('id, name')
    .single()

  if (novo) return { contato: novo, criou: true }

  // Corrida com a ingestão: o cliente escreveu no exato instante em que o
  // operador abria a conversa (na mesma grafia ou na irmã do nono dígito —
  // o índice canônico da 1024 barra as duas). O contato dele é o certo.
  if (error && isUniqueViolation(error)) {
    const correu = await fichaQueVenceu(admin, accountId, digitos)
    if (correu.contato) return { contato: correu.contato, criou: false }
    if (correu.falhou) return { erro: 'LOOKUP_FAILED' }
  }

  console.error('[conversas/abrir] criar contato falhou:', error)
  return { erro: 'CREATE_FAILED' }
}

/** A conversa daquele contato, criando se ainda não houver (UNIQUE da 036). */
async function resolverConversa(
  admin: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  /** Dono da conta — ver o comentário no chamador (FK com CASCADE). */
  donoDaConta: string,
  contactId: string,
): Promise<{ id: string } | { erro: 'LOOKUP_FAILED' | 'CREATE_FAILED' }> {
  const buscar = async (): Promise<{ id: string | null; falhou: boolean }> => {
    // ⚠️ O `error` era descartado (M15 do plano): um blip nesta consulta
    // virava "não existe conversa" e o INSERT de baixo corria — a UNIQUE da
    // 036 barra a duplicata, mas a rota respondia CREATE_FAILED mentindo a
    // causa, e sem a UNIQUE seria uma segunda conversa para o mesmo cliente.
    const { data, error } = await admin
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1)
    if (error) return { id: null, falhou: true }
    return { id: (data?.[0]?.id as string | undefined) ?? null, falhou: false }
  }

  const existente = await buscar()
  if (existente.falhou) return { erro: 'LOOKUP_FAILED' }
  if (existente.id) return { id: existente.id }

  const { data: nova, error } = await admin
    .from('conversations')
    .insert({ account_id: accountId, user_id: donoDaConta, contact_id: contactId })
    .select('id')
    .single()

  if (nova) return { id: nova.id as string }

  if (error && isUniqueViolation(error)) {
    const correu = await buscar()
    if (correu.id) return { id: correu.id }
    if (correu.falhou) return { erro: 'LOOKUP_FAILED' }
  }

  console.error('[conversas/abrir] criar conversa falhou:', error)
  return { erro: 'CREATE_FAILED' }
}
