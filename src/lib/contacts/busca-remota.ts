// ============================================================
// A busca de contato que roda NO BANCO — o filtro `.or()` de um termo
// digitado, montado em um lugar só.
//
// ⚠️⚠️ Existe porque os dois seletores de cliente (o do negócio e o da
// tarefa) carregavam `contacts` INTEIRO para filtrar no navegador, e o
// PostgREST corta em 1000 linhas sem avisar: `error: null`, mil linhas e
// cara de lista completa. Com os ~12.980 contatos que a carga da Kommo
// traz (hoje são 1.212), o cliente do meio do alfabeto em diante
// simplesmente NÃO APARECIA no seletor — sem erro, sem "carregar mais",
// sem nada na tela. O operador lê isso como "o cliente não está no CRM" e
// cadastra de novo, que é a ficha duplicada que a carga passou semanas
// evitando. O comentário do próprio `task-form` já mandava consertar isso
// quando a base passasse de mil.
//
// Irmão de `filtrarContatos` (o mesmo recorte, feito em JS sobre uma lista
// já carregada) e do `.or()` escrito à mão dentro do seletor da agenda.
// Aqui as duas regras difíceis ficam testáveis: o ESCAPE do termo e as
// grafias do NONO DÍGITO.
//
// ⚠️ Uma diferença ASSUMIDA em relação ao `filtrarContatos`: o `ilike` do
// Postgres é indiferente à CAIXA, não ao ACENTO. Buscar "jose" não acha
// "José" — o `unaccent` da casa vive no índice de `messages` (929), e
// `contacts` não tem nada equivalente. É o mesmo comportamento da busca da
// página de Contatos e do seletor da agenda; unificar isso é migration, não
// carona daqui.
// ============================================================

/**
 * Abaixo disto não se consulta. Com 12.980 contatos, uma letra devolve o
 * teto de resultados em ordem arbitrária — o operador leria os 20 primeiros
 * como "os que existem".
 */
export const MIN_TERMO_DE_BUSCA = 2;

/**
 * Quantas linhas o seletor pede. O teto existe para a lista caber na tela;
 * quem chega nele precisa DIZER que chegou (ver `contactSearchMore`), senão
 * o corte silencioso volta, só que em 20 em vez de 1000.
 */
export const TETO_DE_RESULTADOS = 20;

/**
 * O termo dentro de um `.or()` do PostgREST.
 *
 * ⚠️ São DUAS camadas de escape, nesta ordem, e nenhuma é opcional:
 *
 *  1. o do LIKE (`\`, `%`, `_`) — sem ele, um `%` digitado casa a base
 *     inteira e um `_` casa qualquer caractere;
 *  2. o das aspas do PostgREST (`"` e `\`) — o valor viaja dentro da árvore
 *     do `.or()`, onde vírgula e parênteses são DELIMITADORES. "(27) 9283"
 *     sem aspas vira filtro malformado, o erro é descartado e a tela mente
 *     "nenhum cliente" (foi o que o seletor da agenda documentou ao ser
 *     escrito).
 *
 * A segunda camada dobra as barras que a primeira introduziu, e é isso
 * mesmo: o PostgREST desfaz `\\` em `\` antes de entregar ao `ilike`.
 *
 * ⚠️ A forma foi MEDIDA contra o PostgREST real em 20/09/2026 (anon, que a
 * RLS de `contacts` bloqueia — 200 com `[]`, nenhum dado de cliente lido),
 * e não suposta: o teste unitário só conhece a string que este módulo
 * escreve, e foi assim que o `storage.exists()` enganou esta casa. Oito
 * termos passaram, incluindo `silva, jr`, `(83) 98000-0016`, `50%`, `a_b`,
 * `o"brien` e `costa (filho) & cia`. O CONTROLE fecha a medição: o mesmo
 * `silva, jr` SEM as aspas volta **400 PGRST100 — "failed to parse logic
 * tree"**, que é o modo de falha que o seletor da agenda descreve (o erro
 * era descartado e a tela dizia "nenhum cliente").
 */
export function paraIlike(valor: string): string {
  const like = valor.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `"%${like.replace(/(["\\])/g, '\\$1')}%"`;
}

/**
 * As grafias do que foi DIGITADO que podem estar gravadas em
 * `contacts.phone` — a que veio e a irmã com/sem o NONO DÍGITO.
 *
 * ⚠️ É o espelho de `variantesDoNonoDigito`, virado do avesso, e a inversão
 * é obrigatória: lá as variantes são geradas sobre o número do CONTATO, o
 * que só funciona com a lista na mão. Aqui quem filtra é o banco, e não há
 * como transformar a coluna dentro de um `ilike` — então quem ganha as
 * variantes é o TERMO. Sem isso, digitar o número com o 9 deixa de achar a
 * ficha gravada sem ele, e a leitura do operador volta a ser "o cliente não
 * está no CRM" (o defeito que a busca da caixa de entrada consertou em
 * 09/09/2026).
 *
 * ⚠️ A âncora é o FIM do número, nunca o começo, e é o que faz uma regra só
 * cobrir os seis jeitos de digitar. Os 8 últimos dígitos são a parte
 * estável: o DDI e o DDD é que o operador inclui ou não. Ancorada no
 * começo, cada comprimento precisaria do seu caso, e o fragmento sem DDI
 * (o mais comum) não teria nenhum.
 *
 *  "5583980000016" (DDI+DDD+9) → tira o 9 → "558380000016"
 *  "558380000016"  (DDI+DDD)   → põe  o 9 → "5583980000016"
 *  "83980000016"   (DDD+9)     → tira o 9 → "8380000016"
 *  "8380000016"    (DDD)       → põe  o 9 → "83980000016"
 *  "980000016"     (local+9)   → tira o 9 → "80000016"
 *  "80000016"      (local)     → põe  o 9 → "980000016"
 *
 * ⚠️ Só CELULAR, como em `variantesDoNonoDigito`: o 9 foi acrescentado aos
 * móveis, que começam em 6–9. Um fixo ("551133334444") não ganha irmã —
 * inserir o 9 ali fabricaria um número que não existe.
 *
 * ⚠️ Limite escrito: fragmento que termina no MEIO do número ("3980000",
 * colado de um cadastro) sai sozinho, e aí só acha a grafia como está
 * gravada. O filtro em JS cobria esse caso; cobri-lo aqui pediria uma
 * variante por posição de 9, e o `.or()` cresceria a cada uma. Quem digita
 * o telefone digita do fim para trás, que é o que a régua acima cobre.
 */
export function variantesDoTermoTelefonico(digitos: string): string[] {
  if (!digitos) return [];

  const local = digitos.length - 8;
  const ehMovel = (pos: number) => /[6-9]/.test(digitos[pos] ?? '');

  // Tem o 9 logo antes dos 8 finais → a irmã é sem ele.
  if (digitos.length >= 9 && digitos[local - 1] === '9' && ehMovel(local)) {
    return [digitos, digitos.slice(0, local - 1) + digitos.slice(local)];
  }
  // Não tem → a irmã ganha o 9 naquela posição.
  if (digitos.length >= 8 && ehMovel(local)) {
    return [digitos, `${digitos.slice(0, local)}9${digitos.slice(local)}`];
  }
  return [digitos];
}

/**
 * O valor do `.or()` para o termo digitado, ou `null` quando ele é curto
 * demais para valer uma consulta.
 *
 * ⚠️ `null` é "não consulte", nunca "não achei": quem chama precisa manter
 * a diferença na tela, senão o seletor afirma "nenhum cliente" antes de a
 * primeira consulta sair — a armadilha da lista vazia virando afirmação,
 * que este repositório já pagou quatro vezes.
 */
export function ramosDaBuscaDeContato(termo: string): string | null {
  const limpo = termo.trim();
  if (limpo.length < MIN_TERMO_DE_BUSCA) return null;

  const ramos = [`name.ilike.${paraIlike(limpo)}`];

  // O @ do Instagram conta como nome, como em `casaComContato`: a ficha que
  // só existe no Direct (989) não tem telefone nenhum, e é pelo @ que a
  // equipe a conhece. O @ digitado é descartado — a coluna guarda sem ele.
  const arroba = limpo.replace(/^@/, '').trim();
  if (arroba) ramos.push(`instagram_username.ilike.${paraIlike(arroba)}`);

  // ⚠️⚠️ Telefone casa contra `phone_normalized`, NUNCA contra `phone`.
  // `phone` guarda o que o escritório DIGITOU — o formulário de contato
  // preserva a pontuação —, então "+55 (83) 98000-0016" não tem os dígitos
  // contíguos e um padrão de dígitos nunca casa com ele. A ficha continua no
  // banco e some da busca; se ela não tiver nome, fica inalcançável pelos
  // dois seletores. `phone_normalized` é coluna GERADA
  // (`regexp_replace(phone, '\D', '', 'g')`, migration 022), sempre só
  // dígitos, e é a mesma chave do índice único e do `upsertCsvContacts`.
  // Medido em 20/09/2026: 1 dos 1.214 contatos da produção já está assim.
  // (Achado do Codex no PR #231.)
  const digitos = limpo.replace(/\D/g, '');
  for (const grafia of variantesDoTermoTelefonico(digitos)) {
    ramos.push(`phone_normalized.ilike.${paraIlike(grafia)}`);
  }

  return ramos.join(',');
}
