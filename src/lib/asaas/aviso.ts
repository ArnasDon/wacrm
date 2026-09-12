/**
 * O evento global que avisa a tela de que o Asaas mudou — ligar, desligar ou
 * ignorar um cliente, sincronizar, ligar a régua. Vive FORA dos hooks (como
 * `src/lib/execucoes/aviso.ts`): quem emite pode ser o cartão de
 * Configurações, e quem escuta, a caixa de entrada — árvores diferentes.
 */

export const EVENTO_ASAAS_MUDOU = "cb:asaas-mudou";

export function avisarAsaasMudou(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENTO_ASAAS_MUDOU));
}
