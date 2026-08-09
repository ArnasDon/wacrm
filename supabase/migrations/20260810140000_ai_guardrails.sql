-- Safe classifier codes only; generated text is deliberately excluded.

alter table wacrm.agent_traces
  add column if not exists guardrail_violations text[] not null default '{}';

alter table wacrm.agent_traces
  drop constraint if exists agent_traces_guardrail_violations_check;

alter table wacrm.agent_traces
  add constraint agent_traces_guardrail_violations_check
  check (
    guardrail_violations <@ array[
      'control_marker',
      'system_prompt_leak',
      'credential_or_secret',
      'payment_card',
      'unsupported_price',
      'unverified_availability',
      'unsafe_promise'
    ]::text[]
  );
