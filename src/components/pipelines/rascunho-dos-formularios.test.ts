import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Pinos de forma: os dois formulários do funil são componentes com efeito e
// Supabase, e o que está pinado aqui é a CONDIÇÃO que protege o rascunho e o
// banco — tirá-la não quebra nada à vista, só volta a apagar o que foi
// digitado (ou a regravar a etapa velha).
const ler = (caminho: string) =>
  readFileSync(join(process.cwd(), caminho), "utf8");

describe("o formulário do negócio (lápis do card)", () => {
  const form = ler("src/components/pipelines/deal-form.tsx");

  it("só zera o rascunho numa sessão NOVA, não quando `stages` muda de identidade", () => {
    // A recarga da volta ao app troca `stages` por um array novo; com ele
    // nas dependências e sem a chave, voltar do WhatsApp apagava o que tinha
    // sido digitado.
    expect(form).toMatch(/const sessao = deal\s*\?\s*`negocio:\$\{deal\.id\}`/);
    expect(form).toMatch(/if \(sessaoRef\.current === sessao\) return;\s*sessaoRef\.current = sessao;/);
    expect(form).toMatch(/if \(!open\) \{\s*sessaoRef\.current = null;\s*return;\s*\}/);
  });

  it("não regrava funil e etapa que o operador não mudou", () => {
    // O quadro não tem realtime: o card de onde o formulário partiu pode ser
    // de antes de um arrasto, de outro operador ou de uma automação.
    expect(form).toContain("const { pipeline_id, stage_id, ...resto } = payload;");
    expect(form).toContain(
      "const moveu = pipeline_id !== origem.pipeline_id || stage_id !== origem.stage_id;",
    );
    // E mede contra o negócio do INÍCIO da sessão, não contra a prop: a
    // Lista busca o negócio a cada toque no lápis, e uma cópia mais nova do
    // mesmo negócio no meio da sessão não reinicia o rascunho.
    expect(form).toMatch(/sessaoRef\.current = sessao;\s*dealDaSessaoRef\.current = deal \?\? null;/);
    expect(form).toContain("const origem = dealDaSessaoRef.current ?? deal;");
    expect(form).toContain("...escritaDoTituloManual(origem.title, title, agora),");
    expect(form).toMatch(/\.update\(\{\s*\.\.\.resto,\s*\.\.\.\(moveu \? \{ pipeline_id, stage_id \} : \{\}\),/);
    // Na criação o payload inteiro continua indo — funil e etapa são obrigatórios.
    expect(form).toMatch(/\.from\("deals"\)\.insert\(\{\s*\.\.\.payload,/);
  });
});

describe("Gerenciar funil", () => {
  const settings = ler("src/components/pipelines/pipeline-settings.tsx");
  const pagina = ler("src/app/(dashboard)/pipelines/page.tsx");

  it("o rascunho vem do BANCO a cada abertura, não das etapas da página", () => {
    // Semeado das props, ele se perdia a cada recarga da página (a da volta
    // ao app inclusive) e, logo depois de trocar de funil ou de salvar,
    // mostrava etapas de outro funil ou as de antes do salvamento.
    expect(settings).toMatch(/\.from\("pipeline_stages"\)\s*\.select\("\*"\)\s*\.eq\("pipeline_id", pipeline\.id\)/);
    expect(settings).toMatch(/\}, \[open, pipeline\.id, supabase\]\);/);
    expect(pagina).not.toMatch(/<PipelineSettings[^>]*stages=/);
  });

  it("cada abertura tem um número: a leitura, o salvamento, Adicionar, a lixeira e Excluir funil de outra não mexem nela", () => {
    expect(settings).toMatch(/const abertura = \+\+aberturaRef\.current;\s*if \(!open\) return;/);
    // A leitura de uma abertura velha não grava na nova.
    expect(settings).toMatch(/\]\);\s*if \(aberturaRef\.current !== abertura\) return;\s*if \(funil\.error/);
    // Salvar e Excluir funil só fecham a abertura em que começaram.
    expect(settings.match(/if \(aberturaRef\.current === abertura\) onOpenChange\(false\);/g)).toHaveLength(2);
    // Adicionar e lixeira só mexem no rascunho da abertura em que começaram,
    // e pela atualização funcional (duas lixeiras seguidas devolviam a etapa
    // apagada à lista, e o Salvar a recriava).
    expect(settings).toMatch(/if \(aberturaRef\.current !== abertura\) return;[\s\S]{0,200}setLocalStages\(\(atual\) => \[\.\.\.atual, data as PipelineStage\]\);/);
    expect(settings).toMatch(/if \(aberturaRef\.current !== abertura\) return;\s*setLocalStages\(\(atual\) => atual\.filter\(\(s\) => s\.id !== stageId\)\);/);
  });

  it("a leitura espera TODAS as gravações do diálogo que ainda estiverem no ar", () => {
    // Reaberto durante o salvamento (ou a lixeira), o diálogo leria o banco
    // de antes, e salvar de novo desfaria o que acabou de ser gravado.
    expect(settings).toMatch(/await gravacaoRef\.current\?\.catch\(\(\) => undefined\);\s*const \[funil, etapas\] = await Promise\.all/);
    expect(settings).toMatch(/const \[renameRes, stagesRes\] = await registrarGravacao\(/);
    expect(settings).toContain("return registrarGravacao(adicionarEtapa());");
    expect(settings).toContain("return registrarGravacao(removerEtapa(stageId));");
    expect(settings).toMatch(/gravacaoRef\.current = Promise\.allSettled\(\[anteriores, gravacao\]\);/);
  });

  it("durante a carga o nome da página diz qual funil é, somente-leitura (o foco inicial continua no nome)", () => {
    expect(settings).toContain(`value={situacao === "pronto" ? name : pipeline.name}`);
    expect(settings).toContain(`readOnly={situacao !== "pronto"}`);
  });

  it("enquanto carrega, nada afirma nem grava", () => {
    // Lista vazia durante a carga pareceria funil sem etapa: "Adicionar"
    // gravaria na posição 0, e o aviso de Lead acenderia sobre nada.
    expect(settings).toContain(`disabled={saving || situacao !== "pronto" || !name.trim()}`);
    expect(settings).toContain(`disabled={situacao !== "pronto" || !newStageName.trim()}`);
    expect(settings).toMatch(/\{situacao === "pronto" &&\s*localStages\.some\(\(s\) => s\.degrau\)/);
  });
});
