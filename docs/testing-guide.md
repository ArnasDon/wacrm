# Manual testing guide

Work through the parts in order. Each step says what to do and what you
should see. Tick the box when it matches.

- **Part 2** uses your real WhatsApp number, with 2–3 of your own numbers as
  recipients.
- **Parts 3–4** use the **mock Meta API**, which sends nothing real. That's how
  you test speed (80 → 1,000 msg/s) and every kind of error without cost or
  risk.

SQL snippets run in the Supabase dashboard's **SQL Editor**.

---

## Part 0: One-time setup

- [ ] **Migrations 050–053 applied.** Run each file in the SQL Editor if it
      isn't applied yet: `supabase/migrations/050_…` through `053_…`. Check:
  ```sql
  select column_name from information_schema.columns
  where table_name = 'broadcast_recipients' and column_name in ('row_data','claimed_at');
  -- 2 rows
  select proname from pg_proc where proname = 'apply_recipient_results';
  -- 1 row
  ```
- [ ] `npm install`
- [ ] Start the app and the tunnel:
  ```bash
  npm run dev
  ngrok http 3000          # second terminal
  ```
  The Meta webhook URL must be `https://<ngrok-id>.ngrok-free.app/api/whatsapp/webhook`.

---

## Part 1: Automated checks (5 minutes)

```bash
npm test               # 1127 passed
npm run typecheck      # no output
npm run lint           # 0 errors
npm run build          # "Compiled successfully"
npm run loadtest:meta  # ~950 msg/s, "unaccounted 0"
npm run loadtest:meta -- --rate 80 --messages 2000                  # ~75 msg/s
npm run loadtest:meta -- --tier-cap 1000 --meta-cap 600 --messages 12000   # adapts to ~550–600
```

- [ ] All pass; every load test ends with `unaccounted 0`.

---

## Part 2: Features with real WhatsApp

### 2.1 Channels

- [ ] **WhatsApp** in the sidebar lists your channels with status, quality,
      tier and throughput.
- [ ] Refresh a channel. Its details update and a message confirms it.

### 2.2 Templates

- [ ] The stats cards (Total / Approved / In review / Rejected) and the
      filters work.
- [ ] Create a template with a URL button `ourl.cn/{{1}}` and example `5454`.
      It's saved as `https://ourl.cn/{{1}}` with example `https://ourl.cn/5454`,
      and there's no red error screen.
- [ ] URL `https://x.com/{{1}}/page` shows "{{1}} must be at the very end".
- [ ] The send (paper-plane) button on an approved template opens Message
      Testing. Send to your number and it arrives.

### 2.3 Standard campaign

1. [ ] **Campaigns → New Campaign.** The name field comes first, and the cards
       are disabled until you type a name.
2. [ ] **Standard →** no channel is selected, and the list says "Choose a
       channel first".
3. [ ] Pick a channel. The details card shows status, quality, daily limit,
       throughput and mode, and only that channel's templates appear.
4. [ ] Pick a template → **Audience → CSV**. Upload a CSV with a `mobile`
       column holding numbers **without** `+` (e.g. `919812345678`). You see
       the file, the column pickers, valid / invalid / duplicate counts, and
       the first rows.
5. [ ] **Personalize:** the template card is on the left and the WhatsApp
       preview on the right. Change a variable and the preview updates. For
       an image template, **Upload new** swaps the preview image.
6. [ ] **Refresh the page (F5).** You're back on the same step with
       everything filled in.
7. [ ] **Send → Send now.** The messages arrive, and the campaign page opens
       on **Live Monitor**.
8. [ ] Create another campaign and pick **Schedule** for 2 minutes ahead. The
       page shows "Scheduled for …", and at that time it sends by itself.
       The server must stay running.

### 2.4 Advanced campaign

1. [ ] **New Campaign → type a name → Advanced.** The name shows in the page
       header.
2. [ ] The channel dropdown is a multi-select with "Select all connected" and
       "Clear". Each selected channel shows a details card.
3. [ ] Templates: **Add all** adds every template in the list, and the button
       becomes **Remove all**. Clicking an **Added** button removes that one
       template. The send button on a chosen template opens Message Testing.
4. [ ] Speed: move the slider. Each channel shows the rate it will actually
       get, e.g. `80 msg/s · standard tier`.
5. [ ] Upload a CSV. There's **no country-code field**.
6. [ ] Variables with "same values for every template" ticked: one form, one
       **Header image** field applied to all image templates, and **one
       preview** with a "Preview template" dropdown listing every template.
7. [ ] Launch with **Send now**. The messages arrive, and the **Channels &
       templates** panel shows how much each channel sent.
8. [ ] Launch another with **Schedule**. It starts at the chosen time.

### 2.5 Campaign page

- [ ] A running campaign opens on **Live Monitor**, a finished one on
      **Analytics**.
- [ ] **Logs:** filter chips, search, Channel and Template columns
      (advanced), Export CSV.
- [ ] **Retry failed** (when there are failures) sends them again.

---

## Part 3: Speed and error handling with the mock Meta API

### Setup

```bash
npm run mock:meta                          # terminal 3, leave it running
```

Add to `.env.local` and restart `npm run dev`:

```
META_GRAPH_BASE_URL=http://localhost:4010
```

Campaign sends now go to the mock. Its terminal prints `sent/s …` every
second. Everything else (channels, templates) still talks to real Meta.

The mock sends no delivery or read webhooks, so campaigns stop at **Sent**.
That's expected.

Make a test audience:

```bash
npm run gen:csv -- 2000      # test-contacts-2000.csv (fake 91999… numbers)
npm run gen:csv -- 20000
```

**Never send these CSVs through a real channel** (without the mock).

Find your channel ids (needed below):

```sql
select id, name, phone_number_id, throughput_level from whatsapp_config;
```

| #                                      | Do                                                                                        | Expect                                                                                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 **Standard tier**                  | Advanced campaign, 1 channel, speed 80, `test-contacts-2000.csv`                          | Mock terminal ~**78–80 sent/s**; takes ~26 s; campaign → Completed, 2 000 sent                                                                                                           |
| 3.2 **High tier (1,000/s)**            | Set the channel to high (SQL 1 below). Campaign speed **1000**, `test-contacts-20000.csv` | Setup shows `950 msg/s · high throughput`. Mock terminal ~**950 sent/s**; 20 000 done in ~25 s                                                                                           |
| 3.3 **Two channels in parallel**       | Same as 3.2 with 2 high-tier channels                                                     | ~950/s **per channel** (the mock counts per number); Logs show both channels                                                                                                             |
| 3.4 **Meta allows less than the tier** | During 3.2, run SQL 2 below                                                               | Speed drops and settles around 550–600/s; `throttled` rises but **no recipient fails** because of it                                                                                     |
| 3.5 **Template paused mid-send**       | 2 templates (A, B), speed 50, 2 000 rows. During the send, run SQL 3 below                | New sends switch to **B** in seconds; "Channels & templates" shows A crossed out; no failures                                                                                            |
| 3.6 **Channel token expired**          | 2 channels. During the send, run SQL 4 below with channel 1's `phone_number_id`           | Channel 1 stops; **channel 2 sends the rest**; the panel shows channel 1 stopped                                                                                                         |
| 3.7 **Every template paused**          | Run SQL 5 below                                                                           | Everything not yet sent is marked failed with "No usable template left on any channel…" and the campaign finishes (Completed if some went out, Failed if none did). Run SQL 6 afterwards |
| 3.8 **Random errors**                  | Run SQL 7 below, then send 2 000                                                          | Completes. Logs show `[131026] Message undeliverable`, and "No response from Meta — not retried" for resets. Totals add up to 2 000                                                      |
| 3.9 **Meta completely down**           | During a send, stop the mock (Ctrl+C)                                                     | The **app does not crash**. Sends fail as `Network error…` after retries. Restart the mock → **Retry failed** → they go out                                                              |
| 3.10 **Server restart mid-campaign**   | During a 20 000 send, stop `npm run dev` and start it again                               | Within ~2 minutes the campaign continues by itself; nobody is sent twice (SQL 8 below)                                                                                                   |

**Advanced delivery settings** (Distribution step for advanced campaigns;
Review step for standard ones):

| #                                    | Do                                                        | Expect                                                                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.11 **Stop on Meta API error: off** | Run SQL 9 below, then send 200                            | Every recipient fails with `[135000] (#135000) Generic user error`. The campaign carries on to the end and nothing is paused                                                                            |
| 3.12 **Stop on Meta API error: on**  | Tick the box, run SQL 9, send 200                         | After the first `[135000]` failure the campaign becomes **Paused** ("Campaign paused — Meta API error…"). The rest stay pending; other campaigns keep sending. Run SQL 6, then **Resume** → it finishes |
| 3.13 **Quality hold: box off**       | Run SQL 10, send 200                                      | All **Sent**. Logs show the held ones as sent, and `meta_message_status = held_for_quality_assessment` is stored (SQL 11)                                                                               |
| 3.14 **Quality hold: box on**        | Tick the box and repeat 3.13                              | The first held message is still counted as sent, then the campaign **pauses**                                                                                                                           |
| 3.15 **Campaign interval**           | Create 3 campaigns quickly, each with the interval ticked | The first starts at once, the second ≥ 30 s after the first started, the third ≥ 30 s after the second (they may overlap while sending). SQL 12 shows the start times                                   |

```bash
curl -X POST localhost:4010/__mock -d '{"failCode":135000}'   # 9
curl -X POST localhost:4010/__mock -d '{"holdQuality":20}'    # 10
```

```sql
-- 11
select meta_message_status, count(*) from broadcast_recipients
where broadcast_id = 'CAMPAIGN_ID' group by 1;
-- 12
select name, config->>'started_at' as started from broadcasts
where config->>'started_at' is not null order by 2 desc limit 5;
```

The mock control commands used above:

```bash
curl -X POST localhost:4010/__mock -d '{"cap":600}'                                       # 2: Meta allows 600/s
curl -X POST localhost:4010/__mock -d '{"failCode":132015,"failTemplate":"TEMPLATE_A"}'   # 3: template A paused
curl -X POST localhost:4010/__mock -d '{"failCode":190,"failNumber":"PHONE_NUMBER_ID"}'   # 4: token expired
curl -X POST localhost:4010/__mock -d '{"failCode":132015}'                               # 5: every template paused
curl -X POST localhost:4010/__mock -d '{"reset":true}'                                    # 6: back to normal
curl -X POST localhost:4010/__mock -d '{"err5xx":5,"errRecipient":2,"errReset":1}'        # 7: random errors (%)
curl localhost:4010/__mock                                                                # settings + counters
```

The SQL used above:

```sql
-- 1: make a channel high-tier (set it back with throughput_level = 'STANDARD')
update whatsapp_config set throughput_level = 'HIGH' where id = 'CHANNEL_ID';

-- 8: must return 0 rows (nobody got two messages)
select contact_id, count(*) from broadcast_recipients
where broadcast_id = 'CAMPAIGN_ID' and whatsapp_message_id is not null
group by contact_id having count(*) > 1;

-- anything still pending?
select status, count(*) from broadcast_recipients
where broadcast_id = 'CAMPAIGN_ID' group by status;
```

**Clean up after Part 3:**

```sql
delete from broadcasts where name like 'TEST%';               -- name test campaigns "TEST …"
delete from contacts where phone like '+91999%';
update whatsapp_config set throughput_level = 'STANDARD' where throughput_level = 'HIGH';
```

Then remove `META_GRAPH_BASE_URL` from `.env.local` and restart `npm run dev`.

---

## Part 4: Kafka

### Setup (local)

```bash
brew install kafka
brew services start kafka         # localhost:9092
```

Add `KAFKA_BROKERS=localhost:9092` to `.env.local` and restart `npm run dev`.
The terminal shows `[kafka] workers running: webhooks, campaigns, template-status`.

```bash
npm run kafka:check
```

- [ ] `✓ Connected`, four topics ✓, three consumer groups **Stable**, lag 0.

| #                                      | Do                                                                            | Expect                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1 **Webhooks via Kafka**             | Send a WhatsApp message to your number (real Meta, mock off)                  | It appears in the Inbox. `kafka:check`: `webhook.events` count went up, lag 0                                                              |
| 4.2 **Campaign via Kafka**             | Mock on (Part 3 setup), advanced campaign with 2 000 rows                     | Sends as in 3.1. `campaign.sends` grows by 2 000, lag back to 0                                                                            |
| 4.3 **1,000/s via Kafka**              | Repeat 3.2                                                                    | ~950/s in the mock terminal                                                                                                                |
| 4.4 **Template pause via Kafka**       | Repeat 3.5                                                                    | Switches to template B                                                                                                                     |
| 4.5 **Workers stopped → backlog**      | Set `KAFKA_WORKERS=off`, restart dev, start a campaign                        | Nothing sends; `kafka:check` shows **lag > 0**                                                                                             |
| 4.6 **Separate worker drains it**      | `npm run worker:kafka` in another terminal                                    | Sending starts; lag → 0                                                                                                                    |
| 4.7 **Several workers, no duplicates** | Run 3 `npm run worker:kafka` terminals and send 20 000                        | Mock ~950/s per channel; the duplicate check (SQL 8 in Part 3) returns **0 rows**                                                          |
| 4.8 **Kafka down**                     | `brew services stop kafka`, then send a WhatsApp message and start a campaign | No crash. The message reaches the Inbox (terminal: `[kafka] publish … failed`, then handled directly) and the campaign sends without Kafka |

Afterwards: `brew services start kafka` and set `KAFKA_WORKERS` back
(remove it).

---

## Part 4B: Redis (one speed limit per number)

### Setup (local)

```bash
brew install redis
brew services start redis         # localhost:6379
```

Add `REDIS_URL=redis://localhost:6379` to `.env.local`, restart `npm run dev`
(and any `npm run worker:kafka`). The worker prints
`Redis: on — speed limits shared per WhatsApp number across workers`.

```bash
npm run redis:check
```

- [ ] `PING → PONG`, about **155–160 slots in 2 s — OK**, "Redis is ready".

Without WhatsApp numbers or a database, the load test shows the same thing:

```bash
# 2 campaigns on one 80/s number → together ~80/s, almost no 130429s
npm run loadtest:meta -- --rate 80 --meta-cap 80 --messages 3000 --campaigns 2
# 2 numbers × 2 campaigns → ~160/s
npm run loadtest:meta -- --rate 80 --meta-cap 80 --messages 6000 --channels 2 --campaigns 2
```

(With `REDIS_URL` set it uses your Redis; add `--redis-mock` to use an
in-memory one.)

| #                                        | Do                                                                                                                                                                   | Expect                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 4B.1 **Two campaigns, one number**       | Mock on (Part 3), standard-tier channel, `curl -X POST localhost:4010/__mock -d '{"cap":80}'`. Start two advanced campaigns on the **same** channel, 2 000 rows each | Mock terminal: **~80/s total**, not 160; few or no 130429. Each campaign page shows ~40/s while both run, ~80/s when one finishes       |
| 4B.2 **Two numbers**                     | One campaign on channel A, one on channel B                                                                                                                          | ~80/s each, **~160/s total**                                                                                                            |
| 4B.3 **Several workers share the limit** | Kafka on, 3 × `npm run worker:kafka`, one campaign on one channel                                                                                                    | Still ~80/s for that number (not 3 × 80). `npm run redis:check` lists the number with its live rate                                     |
| 4B.4 **Throttle shared**                 | While 4B.3 runs: `curl -X POST localhost:4010/__mock -d '{"cap":60}'`                                                                                                | All workers settle together at ~59/s; `redis:check` shows "last throttled … s ago"                                                      |
| 4B.5 **Redis down**                      | `brew services stop redis` mid-campaign                                                                                                                              | No crash. One `[redis] unavailable, pacing per process` line; sending continues. `brew services start redis` → shared limit again ≤ 5 s |

---

## Part 5: API rate limiting

Create an API key in **Settings → API keys**, then:

```bash
KEY=wacrm_live_xxx
for i in $(seq 1 130); do
  curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $KEY" \
    http://localhost:3000/api/v1/contacts
done | sort | uniq -c
```

- [ ] About 120 × `200` and about 10 × `429` (limit: 120 per minute per key).
- [ ] `curl -i -H "Authorization: Bearer $KEY" http://localhost:3000/api/v1/contacts`
      right after shows the `Retry-After` and `X-RateLimit-Remaining` headers.

The other limits (per user, per minute) work the same way: 60 message sends,
60 campaign batches, 120 reactions, 30 admin actions.

---

## Part 6: Amazon MSK (production)

1. Set `KAFKA_BROKERS` (port 9098), `KAFKA_SASL_MECHANISM=aws-iam` and
   `AWS_REGION` on the app and on the worker (see `docs/kafka.md`).
2. From inside the VPC (ECS task / EC2): `npm run kafka:check` shows
   `✓ Connected`.
3. Repeat **4.1–4.8**, using real numbers for 4.1 and the mock for the rest.
4. Set `REDIS_URL=rediss://…` (ElastiCache, see `docs/kafka.md`) on the app
   and the workers; `npm run redis:check` from inside the VPC, then repeat
   **4B.1–4B.3**.
5. The first real high-volume campaign: start at speed 80. Watch Supabase CPU
   (delivery webhooks add 2–3 writes per message), then raise the speed.
