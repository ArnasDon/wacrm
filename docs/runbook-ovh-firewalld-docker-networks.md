# OVH host runbook — every new Docker network needs a firewalld source

**Applies to:** the shared OVH host at `145.239.154.120` (`ssh ovh`), where
`/opt/eterwa/{app,supabase}` run alongside every other Eter Growth service
(EterShield, Brindouro, Authentik, Zabbix, e2morrow, GLPI, Safeline, ...).
Not specific to EterWA — this is a property of the host, documented here
because EterWA is what tripped over it first.

## The symptom

`supabase-auth` crash-looping with:

```
running db migrations: Migrator: problem creating schema migrations:
couldn't start a new transaction: could not create new transaction:
failed to connect to `host=db user=supabase_auth_admin database=postgres`:
dial error (timeout: dial tcp 192.168.90.11:5436: connect: connection timed out)
```

Note **`connection timed out`**, not `connection refused`. Refused means
"nothing is listening"; timed out on an internal Docker bridge, between
two containers that are both demonstrably up, means something is
**silently dropping the packets** — a firewall, not a config typo.

## The cause

This host runs `firewalld`, and:

```bash
$ sudo firewall-cmd --get-default-zone
drop
```

**The default zone is `drop`.** Every Docker bridge network works —
containers can reach each other — only because someone, when that
network was first created, explicitly added its subnet as a *source* to
either the `trusted` or `docker` zone:

```bash
$ sudo firewall-cmd --get-active-zones
docker
  interfaces: br-9d9383c5604e br-19434542ace7 docker0 ...
  sources: 172.30.0.0/24 192.168.32.0/24
trusted
  interfaces: wg0
  sources: 172.19.0.0/16 172.16.0.0/24 172.16.1.0/24 172.40.0.0/24
drop (default)
  interfaces: eno1
```

A **new** Docker network (a new `docker-compose.yml` project, or any
`docker network create`) gets its own bridge subnet, and that subnet is
**not** in the list above until someone puts it there. Until then, the
network's interface has no zone assignment, so it falls through to the
default zone — `drop` — and every packet between containers on that
network is silently discarded. This is exactly what happened when the
`supabase_default` network (`192.168.90.0/24`) was created for this
project: nothing added it to a zone, so `supabase-auth` could never
reach `supabase-db` even though both containers were healthy and
listening.

## The fix (what was actually run, 09 Aug 2026)

```bash
sudo firewall-cmd --zone=trusted --add-source=192.168.90.0/24 --permanent
sudo firewall-cmd --reload
```

This is purely additive — it only grants a new source to the `trusted`
zone, it does not touch any existing rule for any other service. Verify
with:

```bash
sudo firewall-cmd --zone=trusted --list-sources
```

## Do this every time a new Docker network appears on this host

Whenever a new `docker-compose.yml` project (or a raw `docker network
create`) is deployed on this host, find its bridge subnet and register
it **before** relying on inter-container networking:

```bash
# Find the subnet of a network you just created
sudo docker network inspect <network_name> --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'

# Register it (pick trusted or docker zone — trusted is what every
# other project on this host already uses)
sudo firewall-cmd --zone=trusted --add-source=<subnet> --permanent
sudo firewall-cmd --reload
```

**Do not skip this and reach for raw `iptables`/`nftables` edits
instead.** This host also has a small custom `nftables` table
(`inet eterguard`) for unrelated purposes (see below) — mixing that
with firewalld's own nftables backend is how you get rules that
contradict each other and are much harder to debug than "one more
`--add-source`".

## Things that turned out NOT to be the cause (ruled out, for the next
## person who hits this and is tempted to re-investigate them)

- **Not a subnet-overlap problem.** The instinct to "move the Supabase
  network to a free `/16`" doesn't apply here — every subnet already
  visible in `firewall-cmd --get-active-zones` is *in use* by another
  project's network (e.g. `172.19.0.0/16` is the entire `e2morrow-net`,
  not a free range with room to carve out a smaller block inside it).
  There was never a free block to move into; the fix is zone
  registration, not relocation.
- **Not the `mangle` table.** `sudo nft list ruleset` shows a large set
  of `mangle_PRE_*` chains referencing these same subnets — that's
  `firewalld`'s own nftables backend implementing zone policy, not a
  separate QoS/routing layer. It's downstream of the zone assignment
  above, not an independent thing to edit.
- **Not `inet eterguard`.** This host has one custom nftables table for
  its own purposes:
  ```
  table inet eterguard {
      chain forward {
          type filter hook forward priority -200; policy accept;
          ip saddr 172.31.0.0/16 ct state established,related accept
          ip saddr 172.31.0.0/16 ct state new drop
      }
  }
  ```
  It only restricts new outbound connections *from* `172.31.0.0/16`
  (`eter-ui-net`). It has nothing to do with `192.168.90.0/24` and
  wasn't touched.

## Unrelated finding from the same incident: `supabase-edge-functions`

While recreating the Supabase stack with the fix above,
`supabase-edge-functions` came back up (it's defined in
`supabase/docker-compose.yml` on the server) and immediately
crash-looped:

```
worker boot error: ... JSR package manifest for '@panva/jose' failed to
load ... dns error: failed to lookup address information: Temporary
failure in name resolution
```

This container needs outbound DNS/internet access (to fetch
`jsr.io` packages at boot) that this host's Docker network doesn't
provide, and — separately — **EterWA doesn't use Supabase Edge
Functions at all** (no `supabase/functions` directory in this repo, no
`functions.invoke` call anywhere in the code). It had been deliberately
left disabled by whoever deployed this stack; a `--force-recreate` of
the whole stack brought it back because compose has no memory of "this
one was manually stopped on purpose".

Fixed for real this time by gating it behind a Compose
[`profiles`](https://docs.docker.com/compose/how-tos/profiles/) key in
`/opt/eterwa/supabase/docker-compose.yml` (server-side only — this repo
doesn't need edge functions and has no compose file that defines this
service):

```yaml
  functions:
    profiles: ["disabled"]
    container_name: supabase-edge-functions
    ...
```

A service with `profiles: ["disabled"]` is skipped by `docker compose
up -d` and even `up -d --force-recreate` unless someone explicitly runs
`docker compose --profile disabled up -d`. If Edge Functions are ever
actually needed, the DNS problem has to be solved first, then this key
removed.
