// ============================================================
// A origem PÚBLICA de um pedido — o endereço que o navegador usou.
//
// ⚠️ Nunca `request.nextUrl.origin` (nem `new URL(request.url).origin`)
// para montar um redirecionamento. O servidor standalone do Next escuta em
// `HOSTNAME=0.0.0.0` (Dockerfile), e em produção essa origem é
// `https://0.0.0.0:3000`: medido em 22/09/2026 no `/auth/callback`, que
// mandava a pessoa para lá e a recuperação de senha nunca terminava.
//
// O Traefik repassa o `Host` real (`passHostHeader=true`, docker-stack.yml)
// e acrescenta os `x-forwarded-*`, e é deles que a origem sai. Mesma régua de
// `src/app/api/cb/channels/[id]/connect/route.ts` (`origemDoPedido`) e de
// `src/app/api/account/invitations/route.ts`.
//
// A `reserva` (a URL do próprio pedido) só entra no que faltar: no
// `next dev`, sem proxy, o `host` já é `localhost:3000` e o protocolo é o
// `http:` do pedido.
// ============================================================

/** Primeiro valor de um cabeçalho que pode vir como lista (`a, b`). */
function primeiro(valor: string | null): string {
  return valor?.split(',')[0]?.trim() ?? ''
}

export function origemPublica(headers: Headers, reserva: URL): string {
  const host =
    primeiro(headers.get('x-forwarded-host')) ||
    headers.get('host')?.trim() ||
    reserva.host
  const protocolo =
    primeiro(headers.get('x-forwarded-proto')) || reserva.protocol.replace(/:$/, '')
  return `${protocolo}://${host}`
}
