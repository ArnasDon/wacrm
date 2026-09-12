// ============================================================
// O que o Meu dia guarda NO NAVEGADOR — os dois registros, com o I/O num
// lugar só (a porta de entrada, a página /meu-dia e a guarda de inatividade
// leem daqui; as regras continuam puras em `pendencia.ts` e
// `src/lib/auth/inatividade.ts`).
//
// ⚠️ Toda leitura e escrita é em try/catch, no molde de `use-theme.tsx`: o
// `localStorage` lança em modo privado restrito e por cota. Sem registro, a
// tela aparece (o lado seguro); sem gravação, a confirmação fica em memória
// nesta carga (o `Set` da porta).
// ============================================================

import {
  chaveDeAtividade,
  lerRegistroDeAtividade,
  novoRegistroDeAtividade,
  type RegistroDeAtividade,
} from '@/lib/auth/inatividade';

import {
  chaveDoRegistro,
  lerRegistro,
  type RegistroDeEntrada,
} from './pendencia';

function ler(chave: string): string | null {
  // O shell só instancia a porta depois do spinner de auth, que no servidor é
  // o que se renderiza — mas a guarda custa uma linha e sobrevive a quem
  // mover o componente.
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(chave, valor);
  } catch {
    // Storage indisponível: quem chamou já tem o valor em memória.
  }
}

/** A confirmação do Meu dia (sessão, dia, instante). */
export function lerRegistroDoNavegador(
  userId: string
): RegistroDeEntrada | null {
  return lerRegistro(ler(chaveDoRegistro(userId)));
}

export function gravarRegistroNoNavegador(
  userId: string,
  registro: RegistroDeEntrada
): void {
  gravar(chaveDoRegistro(userId), JSON.stringify(registro));
}

/** O relógio de atividade compartilhado entre as abas (guarda de 4 h). */
export function lerAtividadeDoNavegador(
  userId: string
): RegistroDeAtividade | null {
  return lerRegistroDeAtividade(ler(chaveDeAtividade(userId)));
}

export function gravarAtividadeNoNavegador(
  userId: string,
  sessao: string,
  agoraMs: number
): void {
  gravar(
    chaveDeAtividade(userId),
    JSON.stringify(novoRegistroDeAtividade(sessao, agoraMs))
  );
}

/**
 * O storage grava de verdade? A guarda de inatividade DESLIGA quando não:
 * sem o relógio compartilhado, uma aba ociosa derrubaria quem está
 * trabalhando em outra.
 */
export function storageDisponivel(userId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // Chave por pessoa, no padrão das outras duas — e fora do prefixo delas,
    // para o evento `storage` da sonda não casar com nenhum ouvinte.
    const sonda = `cb-sonda:${userId}`;
    window.localStorage.setItem(sonda, '1');
    window.localStorage.removeItem(sonda);
    return true;
  } catch {
    return false;
  }
}
