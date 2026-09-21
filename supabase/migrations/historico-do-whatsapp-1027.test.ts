// Pinos da 1027 (o histórico de 2026 do WhatsApp). A importação escreve em
// produção por fora do código da ingestão, e cada garantia de "não dispara
// nada, não reabre, não soma não lida, não acende atraso" mora no SQL —
// estes testes cobram que ela continue lá.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(__dirname, '1027_cb_historico_do_whatsapp.sql'), 'utf8');
const semComentarios = sql.replace(/--[^\n]*/g, '');
const importar = semComentarios.slice(
  semComentarios.indexOf('function public.cb_importar_historico_whatsapp'),
  semComentarios.indexOf('function public.cb_desfazer_historico_whatsapp'),
);

describe('1027 — histórico do WhatsApp', () => {
  it('grava gravada_em NULA (senão a retomada lê a fala antiga como "respondeu agora")', () => {
    const insert = importar.slice(importar.indexOf('insert into messages'), importar.indexOf('on conflict (conversation_id, message_id)'));
    expect(insert).toMatch(/gravada_em\)/);
    expect(insert).toMatch(/h\.media_filename,\s*null\s*from _hist/);
  });

  it('desliga os gatilhos de messages PELO NOME e religa os mesmos, nunca USER', () => {
    expect(semComentarios).not.toMatch(/disable trigger user/i);
    for (const g of ['cb_marcar_aguardando_resposta_trigger', 'cb_marcar_janela_da_meta_trigger', 'set_updated_at']) {
      const desliga = semComentarios.match(new RegExp(`disable trigger ${g}`, 'g'))?.length ?? 0;
      const liga = semComentarios.match(new RegExp(`enable trigger ${g}`, 'g'))?.length ?? 0;
      expect(desliga, g).toBeGreaterThan(0);
      expect(liga, g).toBe(desliga);
    }
  });

  it('a conversa nova nasce ENCERRADA, sem responsável, com o dono durável', () => {
    const cria = importar.slice(importar.indexOf('insert into conversations'), importar.indexOf('returning id, contact_id'));
    expect(cria).toMatch(/'closed'/);
    expect(cria).toMatch(/v_dono/);
    expect(cria).not.toMatch(/assigned_agent_id|unread_count|aguardando_desde/);
  });

  it('só troca a prévia de conversa ENCERRADA, e repete a condição no próprio UPDATE', () => {
    const upd = importar.slice(importar.indexOf('update conversations v'), importar.indexOf('get diagnostics v_alteradas'));
    expect(upd).toMatch(/v\.status = 'closed'/);
    expect(upd).toMatch(/v\.last_message_at is null or v\.last_message_at < a\.nova_em/);
    expect(importar).toMatch(/for update of v/);
  });

  it('não toca em status, não lidas, espera ou responsável da conversa', () => {
    expect(importar).not.toMatch(/set\s+status/);
    expect(importar).not.toMatch(/unread_count\s*=/);
    expect(importar).not.toMatch(/aguardando_desde\s*=/);
    expect(importar).not.toMatch(/assigned_agent_id\s*=/);
  });

  it('as duas funções fecham o EXECUTE ao navegador (as duas metades) e abrem ao service_role', () => {
    for (const f of ['cb_importar_historico_whatsapp(uuid, text, jsonb, boolean)', 'cb_desfazer_historico_whatsapp(uuid, text, boolean)']) {
      expect(semComentarios).toContain(`revoke execute on function public.${f}\n  from public, anon, authenticated;`);
      expect(semComentarios).toContain(`grant  execute on function public.${f}\n  to service_role;`);
    }
  });

  it('o registro NÃO é o livro-razão da carga (o desfazer da Kommo aborta em tabela desconhecida)', () => {
    expect(importar).not.toMatch(/migracao_kommo\.livro_razao/);
    expect(importar).toMatch(/migracao_kommo\.historico_whatsapp/);
  });

  it('a conferência CHAMA a função e se desfaz pela exceção própria (nunca WHEN OTHERS)', () => {
    expect(semComentarios).toMatch(/errcode = 'P1027'/);
    expect(semComentarios).toMatch(/when sqlstate 'P1027'/);
    expect(semComentarios).not.toMatch(/when others/i);
  });
});
