# Avaliação manual do agente

A suite usa a mesma função `generateReply` do agente de produção. Por ter
custo e precisar de uma chave real, não corre no CI normal.

```bash
WACRM_EVAL_PROVIDER=openai \
WACRM_EVAL_API_KEY=... \
WACRM_EVAL_MODEL=gpt-5.4-mini \
npm run eval:agent
```

Variáveis opcionais:

- `WACRM_EVAL_SYSTEM_PROMPT`: prompt de negócio que se pretende avaliar;
- `WACRM_EVAL_BASELINE`: pontuação da última versão aprovada, entre 0 e 1;
- `WACRM_EVAL_MINIMUM`: limiar absoluto, por omissão `0.75`;
- `WACRM_EVAL_ALLOWED_REGRESSION`: regressão tolerada, por omissão `0.02`;
- `WACRM_EVAL_SIMULATE=1`: acrescenta quatro conversas completas com personas.

O comando termina com código 1 quando fica abaixo do limiar ou regride mais do
que o permitido. O relatório JSON é escrito para a saída normal, para poder ser
guardado como artefacto de um workflow manual.

`simulateCustomerConversation` também aceita um `agentTurn` completo ou um par
`tools`/`executeTool`. Nos testes de integração, devem ser fornecidas ferramentas
isoladas com dados fictícios; nunca se devem executar mutações de CRM ou envios
WhatsApp reais a partir de uma avaliação.
