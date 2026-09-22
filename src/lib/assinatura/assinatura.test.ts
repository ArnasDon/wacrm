import { describe, expect, it } from 'vitest';

import {
  aplicarAssinatura,
  assinaturaExistente,
  custoDaAssinatura,
  nomeDePessoa,
  prefixoDeAssinatura,
  removerAssinatura,
  saneiaNome,
} from './assinatura';

describe('saneiaNome', () => {
  it('tira os marcadores de formatação do WhatsApp', () => {
    // `*Ana*Paula:*` fecharia o negrito no lugar errado e o cliente veria
    // asterisco cru no meio do nome.
    expect(saneiaNome('Ana*Paula')).toBe('AnaPaula');
    expect(saneiaNome('Jo~ao_Pedro`')).toBe('JoaoPedro');
  });

  it('normaliza espaço e apara as pontas', () => {
    expect(saneiaNome('  Rodrigo   Tavares  ')).toBe('Rodrigo Tavares');
  });

  it('devolve null quando não sobra nada — o sinal de "não assine"', () => {
    // O trigger de signup grava COALESCE(full_name, ''), então NOT NULL não
    // garante não-vazio. Sem isto a assinatura sairia `*:*` para o cliente.
    expect(saneiaNome('')).toBeNull();
    expect(saneiaNome('   ')).toBeNull();
    expect(saneiaNome('***')).toBeNull();
    expect(saneiaNome(null)).toBeNull();
    expect(saneiaNome(undefined)).toBeNull();
  });
});

describe('nomeDePessoa', () => {
  it('usa o nome COMPLETO', () => {
    // Decisão do operador (2026-08-01): num escritório de advocacia o cliente
    // precisa saber com qual advogado falou, e o primeiro nome não identifica
    // ninguém. É o nome que ele vê na procuração.
    expect(nomeDePessoa('Rodrigo Tavares Monteiro', null)).toBe(
      'Rodrigo Tavares Monteiro',
    );
  });

  it('normaliza o espaço do nome completo', () => {
    expect(nomeDePessoa('  Ana   Paula  Souza ', null)).toBe('Ana Paula Souza');
  });

  it('cai para o e-mail sem o domínio quando não há nome', () => {
    expect(nomeDePessoa('', 'leonardo@exemplo.com')).toBe('leonardo');
    expect(nomeDePessoa(null, 'leonardo@exemplo.com')).toBe('leonardo');
  });

  it('devolve null quando não há nem nome nem e-mail', () => {
    expect(nomeDePessoa(null, null)).toBeNull();
    expect(nomeDePessoa('', '')).toBeNull();
  });
});

describe('prefixoDeAssinatura', () => {
  it('monta `*Nome:*` com quebra de linha', () => {
    expect(prefixoDeAssinatura('Leonardo')).toBe('*Leonardo:*\n');
  });

  it('é string vazia sem nome, para o chamador concatenar sem `if`', () => {
    expect(prefixoDeAssinatura(null)).toBe('');
    expect(prefixoDeAssinatura('  ')).toBe('');
  });
});

describe('aplicarAssinatura', () => {
  it('põe o prefixo antes do corpo', () => {
    expect(aplicarAssinatura('Bom dia', 'Leonardo')).toBe(
      '*Leonardo:*\nBom dia',
    );
  });

  it('NÃO assina texto vazio nem ausente', () => {
    // Legenda vazia assinada viraria uma mensagem cujo conteúdo é só o nome
    // de quem mandou. Áudio não tem legenda — sai sem assinatura.
    expect(aplicarAssinatura('', 'Leonardo')).toBe('');
    expect(aplicarAssinatura('   ', 'Leonardo')).toBe('   ');
    expect(aplicarAssinatura(null, 'Leonardo')).toBeNull();
    expect(aplicarAssinatura(undefined, 'Leonardo')).toBeUndefined();
  });

  it('não assina quando não há nome utilizável', () => {
    expect(aplicarAssinatura('Bom dia', null)).toBe('Bom dia');
    expect(aplicarAssinatura('Bom dia', '***')).toBe('Bom dia');
  });

  it('é idempotente — não empilha assinatura', () => {
    const uma = aplicarAssinatura('Bom dia', 'Leonardo')!;
    expect(aplicarAssinatura(uma, 'Leonardo')).toBe(uma);
  });

  it('preserva quebras de linha do corpo', () => {
    expect(aplicarAssinatura('Linha 1\nLinha 2', 'Ana')).toBe(
      '*Ana:*\nLinha 1\nLinha 2',
    );
  });
});

describe('removerAssinatura', () => {
  it('tira a assinatura e devolve o corpo intacto', () => {
    expect(removerAssinatura('*Leonardo:*\nBom dia')).toBe('Bom dia');
  });

  it('tira assinatura de OUTRA pessoa — inclusive de quem saiu da equipe', () => {
    expect(removerAssinatura('*Ana:*\nBom dia')).toBe('Bom dia');
    expect(removerAssinatura('*CB Advogados:*\nBom dia')).toBe('Bom dia');
  });

  it('não mexe em texto sem assinatura', () => {
    expect(removerAssinatura('Bom dia')).toBe('Bom dia');
    expect(removerAssinatura('*negrito* no meio')).toBe('*negrito* no meio');
  });

  it('não come negrito legítimo que o cliente escreveu', () => {
    // Sem o `:` antes do fechamento e a quebra de linha, não é assinatura.
    expect(removerAssinatura('*urgente*\nvamos falar')).toBe(
      '*urgente*\nvamos falar',
    );
  });

  it('tira só a PRIMEIRA — o resto do corpo é do cliente', () => {
    expect(removerAssinatura('*Ana:*\n*Leonardo:*\noi')).toBe(
      '*Leonardo:*\noi',
    );
  });

  it('ida e volta devolve o original', () => {
    const corpo = 'Bom dia, tudo bem?\nSegue o documento.';
    expect(removerAssinatura(aplicarAssinatura(corpo, 'Leonardo'))).toBe(corpo);
  });

  it('atravessa null e undefined sem quebrar', () => {
    expect(removerAssinatura(null)).toBeNull();
    expect(removerAssinatura(undefined)).toBeUndefined();
  });
});

describe('assinaturaExistente', () => {
  it('devolve a assinatura literal, com a quebra de linha', () => {
    expect(assinaturaExistente('*Rodrigo Tavares Monteiro:*\nBom dia')).toBe(
      '*Rodrigo Tavares Monteiro:*\n',
    );
  });

  it('devolve vazio quando não há assinatura', () => {
    expect(assinaturaExistente('Bom dia')).toBe('');
    expect(assinaturaExistente(null)).toBe('');
    expect(assinaturaExistente('')).toBe('');
  });

  it('recompõe a mensagem editada preservando QUEM assinou', () => {
    // O caso real da edição: o operador recebe só o corpo, edita, e o
    // servidor recoloca a assinatura ORIGINAL — mesmo que quem edita seja
    // outra pessoa, ou que o interruptor tenha sido desligado desde o envio.
    const original = '*Ana Paula Souza:*\nBom dia';
    const corpoEditado = 'Bom dia, corrigido';
    expect(assinaturaExistente(original) + corpoEditado).toBe(
      '*Ana Paula Souza:*\nBom dia, corrigido',
    );
  });
});

describe('custoDaAssinatura', () => {
  it('conta exatamente o que o prefixo acrescenta', () => {
    // É o que permite descontar do teto de 1024 ANTES de validar. Sem isso,
    // uma legenda de 1020 passa na validação e a Meta recusa a prefixada —
    // 502 no lugar de um aviso claro.
    expect(custoDaAssinatura('Leonardo')).toBe('*Leonardo:*\n'.length);
    expect(custoDaAssinatura(null)).toBe(0);
  });

  it('bate com o tamanho real do texto assinado', () => {
    const corpo = 'x'.repeat(100);
    const assinado = aplicarAssinatura(corpo, 'Ana')!;
    expect(assinado.length).toBe(corpo.length + custoDaAssinatura('Ana'));
  });
});
