# Deploy do wacrm na VPS (Docker Swarm + Traefik)

Guia para subir o wacrm direto na VPS, em uma URL pública com HTTPS
(ex.: `crm-docker.hiperfoco.net`), seguindo o padrão que já roda aqui: **Docker
Swarm** para os serviços e **Traefik** como reverse proxy/ TLS (Let's
Encrypt). Tudo na mão, sem painel.

> Resumo rápido: preenche o `.env.local`, aplica as migrations no Supabase,
> roda `./deploy.sh`. O Traefik emite o certificado sozinho.

---

## 0. Como o roteamento funciona aqui

O Traefik desta VPS detém as portas **80/443** e roteia por *labels* dos
serviços Swarm. Pontos fixos do ambiente (não invente outros nomes):

| Item                | Valor                                            |
| ------------------- | ------------------------------------------------ |
| Rede overlay        | `OrionNet` (externa, a que o Traefik observa)    |
| Resolver de TLS     | `letsencryptresolver` (HTTP-01 na entrypoint web)|
| Entrypoint HTTP     | `web` (:80)                                       |
| Entrypoint HTTPS    | `websecure` (:443)                                |
| Porta interna do app| `3000`                                            |

O Traefik está com `--providers.swarm=true`, então as labels de roteamento
ficam em **`deploy.labels`** do serviço (e não em `labels` no nível do
container). O `docker-stack.yml` deste repo já segue esse formato, espelhado
do stack `meunobre`.

---

## 1. Pré-requisitos (uma vez)

- **DNS**: `crm-docker.hiperfoco.net` → IP da VPS (`147.79.106.221`). Confirme:
  ```bash
  dig +short crm-docker.hiperfoco.net
  ```
- **Rede `OrionNet`** existente (já existe; só confira):
  ```bash
  docker network ls | grep OrionNet
  ```
- **Swarm ativo** (já está; confira):
  ```bash
  docker info --format '{{.Swarm.LocalNodeState}}'   # deve dizer: active
  ```

---

## 2. Supabase dedicado

O wacrm é construído sobre o Supabase. Use um projeto/instância **dedicado**
para o CRM e aponte o `.env.local` para ele. O schema completo vive em
`supabase/migrations/` (26 arquivos `.sql`, numerados — devem ser aplicados
**em ordem**).

Aplicando as migrations do zero com `psql` (substitua a connection string
pela do banco dedicado — Project Settings → Database → Connection string):

```bash
export DATABASE_URL='postgresql://postgres:SENHA@HOST:5432/postgres'

for f in $(ls supabase/migrations/*.sql | sort); do
  echo ">> aplicando $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

> Se o Supabase dedicado roda como container nesta VPS, você pode rodar o
> loop de dentro do container de banco (`docker exec -i <db> psql ...`) ou
> apontar `DATABASE_URL` para `127.0.0.1:5432` conforme a porta publicada.

Storage: as migrations `008` e `016`/`023` criam buckets/políticas para
avatares e mídia de chat. Não é preciso passo manual além de rodar os `.sql`.

---

## 3. Variáveis de ambiente (`.env.local`)

Copie o exemplo e preencha:

```bash
cp .env.local.example .env.local
$EDITOR .env.local
```

Obrigatórias (o app não sobe sem elas):

| Variável                        | Onde / quando é usada                                  |
| ------------------------------- | ------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | **build** (inlinada no cliente)                        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **build** (inlinada no cliente)                        |
| `SUPABASE_SERVICE_ROLE_KEY`     | runtime (server-side; bypassa RLS)                     |
| `ENCRYPTION_KEY`                | runtime — 64 hex (32 bytes). `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `META_APP_SECRET`               | runtime — valida o HMAC do webhook do WhatsApp         |

Recomendada:

| Variável               | Valor                          |
| ---------------------- | ------------------------------ |
| `NEXT_PUBLIC_SITE_URL` | `https://crm-docker.hiperfoco.net`    |

> **Por que o `.env.local` entra na imagem:** as vars `NEXT_PUBLIC_*` são
> embutidas no JS do cliente **durante o `next build`** — precisam existir no
> momento do build. Por isso o `Dockerfile` copia o `.env.local` para o
> contexto e o `.dockerignore` **não** o ignora. As vars server-side são
> lidas em runtime do mesmo arquivo. Trocar qualquer env = rebuild + redeploy
> (passo 4). Os segredos ficam dentro da imagem local; não publique essa
> imagem em registry público.

---

## 4. Build + deploy

Um comando:

```bash
./deploy.sh
```

Ele faz:

1. `docker build -t wacrm:latest .` — build multi-stage (deps → build →
   runtime enxuto rodando `next start`).
2. `docker stack deploy -c docker-stack.yml --resolve-image=never wacrm` — o
   `--resolve-image=never` é essencial: a imagem é **local**, sem isso o
   Swarm tentaria puxá-la de um registry e falharia.

Equivalente manual, se preferir:

```bash
docker build -t wacrm:latest .
docker stack deploy -c docker-stack.yml --resolve-image=never wacrm
```

---

## 5. Verificação

```bash
# serviço subiu? (REPLICAS deve ser 1/1)
docker service ls | grep wacrm

# logs do app
docker service logs -f wacrm_app

# o Traefik registrou o router? (procure por wacrm)
docker service logs traefik_traefik 2>&1 | grep -i wacrm | tail

# certificado + resposta pública
curl -I https://crm-docker.hiperfoco.net
```

A primeira emissão do certificado Let's Encrypt leva alguns segundos após o
primeiro acesso HTTPS. Se der erro de TLS logo de cara, espere ~30s e tente
de novo (o desafio HTTP-01 precisa do DNS já propagado e da porta 80
acessível pelo Traefik).

---

## 6. Atualizações (redeploy)

```bash
git pull            # se aplicável
./deploy.sh         # rebuild + redeploy na mesma imagem/stack
```

O Swarm faz rolling update do serviço `wacrm_app`. Para forçar:

```bash
docker service update --force wacrm_app
```

## Remover

```bash
docker stack rm wacrm
```

---

## 7. Troubleshooting

| Sintoma                                   | Causa provável / ação                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `No such image: wacrm:latest`             | Faltou `--resolve-image=never` no `stack deploy` (o `deploy.sh` já passa).            |
| 404 do Traefik em `crm-docker.hiperfoco.net`     | Serviço não está na rede `OrionNet`, ou labels em `labels` em vez de `deploy.labels`. |
| Página sem estilo / `/_next/*.js` 404     | Cache de CDN servindo HTML antigo — ver nota de Cache-Control no `next.config.ts`.    |
| Cliente conecta no Supabase errado        | `NEXT_PUBLIC_*` foi trocada mas não houve **rebuild** (é build-time).                 |
| Certificado não emite                     | DNS ainda não propagou, ou porta 80 não chega no Traefik. Cheque `dig` e logs Traefik.|
| App sobe mas erro 500 no Supabase         | `SUPABASE_SERVICE_ROLE_KEY` ausente/errada, ou migrations não aplicadas.              |

---

## Arquivos deste setup

- `Dockerfile` — build de produção (`next start`).
- `.dockerignore` — exclui `node_modules`/`.next`/`.git`; **mantém** `.env.local`.
- `docker-stack.yml` — serviço Swarm + labels do Traefik para `crm-docker.hiperfoco.net`.
- `deploy.sh` — build + deploy em um comando.
