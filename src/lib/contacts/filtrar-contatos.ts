// ------------------------------------------------------------
// Busca de contato por NOME ou TELEFONE (seletor pesquisável, 2026-08-30).
//
// Módulo puro, irmão do `casaComABusca` do inbox — mas com uma diferença
// deliberada no telefone: aqui a comparação é DÍGITO contra DÍGITO. O
// operador digita "11 3178" ou "(27) 9283…" e o banco guarda "551131…";
// substring crua (o que o inbox faz) exigiria digitar exatamente como está
// gravado. `soDigitos` nas duas pontas torna a máscara irrelevante.
// ------------------------------------------------------------

import { semAcento } from '@/lib/inbox/busca-em-mensagens';
import { variantesDoNonoDigito } from '@/lib/contacts/telefone';

export interface ContatoPesquisavel {
  name: string | null;
  /** NULO na ficha só do Instagram (989). */
  phone: string | null;
  instagram_username?: string | null;
}

/** Só os dígitos — "+55 (11) 3000-0018" e "551130000018" viram comparáveis. */
function soDigitos(s: string): string {
  return s.replace(/\D/g, '');
}

/**
 * O termo casa com o contato quando o NOME (sem acento/caixa) contém o
 * termo, OU quando os dígitos do telefone contêm os dígitos do termo.
 *
 * ⚠️ O ramo do telefone só corre quando o termo TEM dígito: "ana" sem a
 * guarda viraria `""` depois do strip, e `includes("")` é verdadeiro para
 * todo telefone — a mesma armadilha da agulha vazia documentada no salto
 * da busca (`achados-no-fio`).
 *
 * ⚠️ O telefone é comparado nas DUAS grafias do nono dígito
 * (`variantesDoNonoDigito`), como no inbox: a ficha gravada sem o 9 tem de
 * aparecer para quem digita o número com ele, que é como o número se lê no
 * celular. Só o lado do CONTATO ganha variante — o termo é o que a pessoa
 * digitou.
 */
export function casaComContato(
  contato: ContatoPesquisavel,
  termo: string
): boolean {
  const q = semAcento(termo.trim());
  if (!q) return true;

  if (semAcento(contato.name ?? '').includes(q)) return true;
  // O @ do Instagram conta como nome: é como a equipe conhece o cliente.
  if (
    contato.instagram_username &&
    semAcento(contato.instagram_username).includes(q.replace(/^@/, ''))
  ) {
    return true;
  }

  const digitosDoTermo = soDigitos(termo);
  return (
    digitosDoTermo.length > 0 &&
    variantesDoNonoDigito(soDigitos(contato.phone ?? '')).some((grafia) =>
      grafia.includes(digitosDoTermo)
    )
  );
}

/** A lista recortada pelo termo — vazio devolve todos, como todo filtro da casa. */
export function filtrarContatos<T extends ContatoPesquisavel>(
  contatos: T[],
  termo: string
): T[] {
  return contatos.filter((c) => casaComContato(c, termo));
}
