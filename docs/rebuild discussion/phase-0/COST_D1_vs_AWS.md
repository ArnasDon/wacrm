# Cost Analysis — D1 vs AWS (reporting-heavy workload)

Feeds `DATABASE_DECISION.md`. Focus: a **reporting/analytics USP** changes the DB math, because reporting = heavy aggregate reads.

## The decisive fact
**Cloudflare D1 bills aggregate queries by rows *scanned*, not rows returned.** A `GROUP BY` / full scan counts every examined row ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)). AWS RDS/Aurora bill **compute-time**, not rows — so heavy aggregation is "free" beyond the instance/ACU cost. This flips the comparison entirely depending on whether reporting reads hit **pre-aggregated rollups** or **raw tables**.

## Unit pricing (2026)
| | Price |
|---|---|
| **D1** (Workers Paid $5/mo base) | reads $0.001 / M rows (25B/mo incl.) · writes $1.00 / M rows (50M/mo incl.) · storage $0.75/GB-mo (5GB incl.) · **~10GB per-database soft limit** |
| **Aurora Serverless v2 (Postgres)** | $0.12 / ACU-hr (0.5 ACU min ≈ $44/mo, or scale-to-zero) · storage $0.10/GB-mo · + I/O (Standard) |
| **RDS Postgres (fixed, Multi-AZ prod)** | instance/hr (t4g.small MAZ ≈ $60/mo → r6g.2xl ≈ $1,200/mo) · storage $0.115/GB-mo · + I/O |
| **DynamoDB on-demand** | $1.25/M WRU · $0.25/M RRU · $0.25/GB-mo — **no GROUP BY / joins / ad-hoc analytics** |
| **Neon (Postgres, non-AWS reference)** | usage-based compute + storage; typically **cheaper than Aurora** for spiky/low load, Cloudflare-adjacent |

## Workload model
Per active tenant/month (busy WhatsApp CRM): ~100k message-class rows written; ~600k rows resident (rolling history); reporting ≈ 500 dashboard loads + 50 exports. Tiers: **Small 10 tenants · Medium 100 · Large 1,000.**

### D1 read cost — rollups vs naive (the whole game)
Naive (dashboards scan raw message tables, ~2.4B rows/tenant/mo):
- Large (1,000): ≈ 2,400,000 M rows − 25,000 incl. = **≈ $2,375/mo just for reads**. Medium ≈ $215/mo.

With **pre-aggregated daily rollups** (dashboards scan ~hundreds of summary rows, ≈ 2M rows/tenant/mo):
- Large: ≈ 2,000 M rows → **within the 25B included → ~$0**. Medium/Small: ~$0.

→ **Reporting on D1 is only viable with rollups.** With them, D1 reads are effectively free; without them, cost explodes ~1000×.

## Monthly totals (with rollups; realistic prod)
| Scale | **D1** (+rollups) | **Aurora Serverless v2** | **RDS fixed (MAZ)** | Neon (ref) |
|---|---|---|---|---|
| Small (10) | **~$5** ($5 base, reads ~$0, storage free) | ~$88–130 | ~$60–90 | ~$20–40 |
| Medium (100) | **~$24** ($5 + ~$19 storage/25GB over) | ~$180–350 | ~$300–400 | ~$80–150 |
| Large (1,000) | **~$276** ($5 + $50 writes + ~$221 storage) | ~$700–1,400 | ~$1,200+ | ~$300–600 |

DynamoDB excluded from the table: unusable for ad-hoc/custom analytical reports (no server-side aggregation/joins); would need everything pre-computed + GSIs that multiply write cost.

## D1 caveats that a reporting USP hits first
1. **~10GB per-database limit** → at medium/large scale, one shared D1 DB won't hold all tenants. Forces **DB-per-tenant sharding** (Cloudflare supports many D1 DBs; aligns with tenant isolation but adds fan-out for cross-tenant/platform-admin reporting and migration ops).
2. **Rows-scanned billing** punishes any un-rolled-up query — a custom report builder running ad-hoc scans is a cost landmine. Must constrain the builder to rollup tables or cap scan ranges.
3. **SQLite analytics ceiling** — weaker/limited window functions, no materialized views, lower write concurrency than Postgres. A "strong reporting" product leans on exactly these.

## Verdict / recommendation
- **On raw cost, D1 wins decisively (5–10×) at every scale — but only with disciplined rollups**, and it hits a per-DB size + concurrency wall that a reporting-heavy product feels first.
- Because **reporting is the USP** (ad-hoc/custom builder, deep history, complex aggregation), the analytical path wants a real analytical engine. **Recommend Postgres for the reporting/analytical path — Neon preferred over AWS Aurora** (cheaper for spiky load, Cloudflare-adjacent, no per-DB wall, materialized views + window functions). AWS Aurora/RDS only if an AWS mandate exists; DynamoDB not for this.
- **Either way, serve reporting from pre-aggregated rollups behind the `DatabaseProvider`** (`reporting/TRD.md`). This keeps D1 viable-and-cheap for the operational store while the analytical engine choice stays swappable. Confirm with the DB benchmark: run the analytical rollup + ad-hoc queries on D1 and Neon; if D1's rows-scanned cost or SQLite analytics limits fail the reporting acceptance, the reporting path goes Postgres even if the operational store stays D1.

Sources: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [Aurora Serverless v2 guide](https://www.usage.ai/blogs/aws/rds/aurora-serverless-v2/) · [DynamoDB pricing 2026](https://www.bytebase.com/blog/understanding-dynamodb-pricing/)
