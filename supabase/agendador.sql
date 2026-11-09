-- ============================================================
-- Relógio de hora em hora do Sistema iBox (rodar UMA vez no SQL Editor).
--
-- Chama https://crmwga.com/api/agendador no minuto 5 de cada hora, para as
-- automações da equipe saírem na hora marcada. A chave fica guardada no
-- Vault do Supabase (criptografada); o código só conhece o SHA-256 dela.
-- Pode rodar de novo sem problema: troca o agendamento pelo mesmo.
--
-- O arquivo com a chave preenchida NÃO vai para o repositório.
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- guarda (ou troca) a chave no Vault
do $$
begin
  if exists (select 1 from vault.secrets where name = 'ibox_agendador_chave') then
    perform vault.update_secret((select id from vault.secrets where name = 'ibox_agendador_chave'), '__CHAVE__');
  else
    perform vault.create_secret('__CHAVE__', 'ibox_agendador_chave', 'Chave do relógio de hora em hora do Sistema iBox');
  end if;
end $$;

-- agenda (substitui se já existir)
select cron.unschedule('ibox-agendador') where exists (select 1 from cron.job where jobname = 'ibox-agendador');
select cron.schedule(
  'ibox-agendador',
  '5 * * * *',
  $$
  select net.http_get(
    url := 'https://crmwga.com/api/agendador',
    headers := jsonb_build_object('x-agendador-chave', (select decrypted_secret from vault.decrypted_secrets where name = 'ibox_agendador_chave')),
    timeout_milliseconds := 55000
  );
  $$
);

-- conferir: deve mostrar 1 linha "ibox-agendador"
select jobname, schedule, active from cron.job where jobname = 'ibox-agendador';
