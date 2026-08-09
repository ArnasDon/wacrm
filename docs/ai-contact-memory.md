# Memória de contacto da IA

O agente pode resumir factos duráveis de conversas fechadas ou inactivas e
recuperar apenas os resumos relevantes quando o mesmo contacto volta a falar.
O processamento é assíncrono em `GET /api/ai/memory/cron`; não atrasa a resposta
WhatsApp.

## Privacidade e retenção

- A memória é isolada por `account_id` e `contact_id`, com RLS e validação nos
  RPCs de pesquisa.
- Conversas, argumentos de ferramentas e respostas integrais não são copiados
  para traces. A memória guarda somente um resumo curto.
- O prompt de resumo exclui credenciais, cartões, documentos de identidade,
  moradas completas, saúde e contactos desnecessários.
- Cada memória expira ao fim de 365 dias; o cron apaga os registos expirados.
- A eliminação da conta ou do contacto apaga as memórias em cascata. Um
  administrador da conta também pode eliminá-las directamente para responder a
  um pedido de apagamento.

O operador da instalação deve descrever este tratamento e o prazo de retenção
no seu próprio aviso de privacidade, de acordo com a legislação aplicável.

## Operação

Configure `AUTOMATION_CRON_SECRET` e chame a rota com o cabeçalho
`x-cron-secret`. Por omissão, conversas fechadas são processadas imediatamente e
conversas abertas após 24 horas sem actividade. O intervalo pode ser alterado
com `AI_MEMORY_INACTIVE_HOURS`.
