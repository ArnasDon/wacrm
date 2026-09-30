# Kafka (Amazon MSK)

Kafka is optional. Without `KAFKA_BROKERS` the app works exactly as before:
webhooks are processed in the request's `after()` and advanced campaigns are
sent by the in-process runner. Set it, and three flows move onto topics:

| Topic (default prefix `wacrm.`) | Producer                                                | Consumer group             | What it does                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhook.events`                | `POST /api/whatsapp/webhook`, after the signature check | `wacrm.webhook-processors` | Meta webhooks are acknowledged immediately and processed by workers; 3 tries, then `webhook.events.dlq`                                               |
| `campaign.sends`                | the campaign scheduler (dispatch)                       | `wacrm.campaign-senders`   | one message per recipient, keyed by channel; workers send, fall back to the next template on a pause, re-route to another channel when one is blocked |
| `template.status`               | webhook processing of `message_template_status_update`  | one group **per process**  | every running sender drops a paused/disabled template immediately                                                                                     |

Delivery is at-least-once. A worker claims each recipient
(`broadcast_recipients.claimed_at`, migration 051) before sending, so a
redelivered message never sends twice. A claim left by a crashed worker goes
stale after 10 minutes and the scheduler re-queues it.

If a publish fails (cluster unreachable), the app falls back to the
in-process path, so nothing is lost during a Kafka outage.

## Environment

```bash
KAFKA_BROKERS=b-1.xxx.kafka.ap-south-1.amazonaws.com:9098,b-2.xxx...:9098
KAFKA_SASL_MECHANISM=aws-iam       # or scram-sha-512 / scram-sha-256 / plain
AWS_REGION=ap-south-1              # for aws-iam
# KAFKA_SASL_USERNAME= / KAFKA_SASL_PASSWORD=   for SCRAM
# KAFKA_SSL=true                   # implied by aws-iam and scram
# KAFKA_TOPIC_PREFIX=wacrm.        # separate prod/staging on one cluster
# KAFKA_PARTITIONS=6               # partitions for topics the app creates
# KAFKA_REPLICATION_FACTOR=-1      # broker default (MSK: 3)
# KAFKA_WORKERS=off                # don't run consumers inside the web app
```

Topics are created on first use if they don't exist. The IAM principal (or
SCRAM user) therefore needs create-topic permission, or you create the four
topics yourself.

## Amazon MSK setup

1. **Create a cluster.** MSK provisioned or Serverless. MSK Serverless
   supports IAM auth only.
2. **Pick an auth method.**
   - **IAM (recommended):** brokers on port **9098**, `KAFKA_SASL_MECHANISM=aws-iam`.
     Credentials come from the standard AWS chain: the ECS task role, EC2
     instance profile, or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` /
     `AWS_SESSION_TOKEN`.
   - **SCRAM:** brokers on port **9096**, `KAFKA_SASL_MECHANISM=scram-sha-512`.
     Store the user in Secrets Manager and associate it with the cluster.
3. **Network.** The app and the workers must be able to reach the brokers.
   Run them in the cluster's VPC, e.g. ECS or EC2 in the same subnets, and
   allow the ports in the security group. MSK public access is also possible
   but needs IAM or SCRAM.
4. **IAM policy for the task role** (adjust the region, account and cluster):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["kafka-cluster:Connect", "kafka-cluster:DescribeCluster"],
      "Resource": "arn:aws:kafka:REGION:ACCOUNT:cluster/CLUSTER/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kafka-cluster:CreateTopic",
        "kafka-cluster:DescribeTopic",
        "kafka-cluster:ReadData",
        "kafka-cluster:WriteData"
      ],
      "Resource": "arn:aws:kafka:REGION:ACCOUNT:topic/CLUSTER/*/wacrm.*"
    },
    {
      "Effect": "Allow",
      "Action": ["kafka-cluster:AlterGroup", "kafka-cluster:DescribeGroup"],
      "Resource": "arn:aws:kafka:REGION:ACCOUNT:group/CLUSTER/*/wacrm.*"
    },
    {
      "Effect": "Allow",
      "Action": ["kafka-cluster:WriteDataIdempotently"],
      "Resource": "arn:aws:kafka:REGION:ACCOUNT:cluster/CLUSTER/*"
    }
  ]
}
```

## Running the workers

- **Inside the app** (default): `next start` / Docker starts the consumers
  from `src/instrumentation.ts`.
- **Separately** (scale independently): set `KAFKA_WORKERS=off` on the app
  and run workers from `Dockerfile.worker`:

```bash
docker build -f Dockerfile.worker -t wacrm-worker .
docker run --env-file .env.local wacrm-worker     # or an ECS service
```

`campaign.sends` partitions are shared across the worker group, so more tasks
means more channels sending in parallel, up to the partition count. Each
worker also runs the campaign scheduler (`WORKER_SCHEDULER=off` to skip it).
Overlapping schedulers are safe: they share the run lock.

Vercel can't run consumers (no long-lived process). There, the app only
produces, and the workers run on AWS.

## Redis: one speed limit per WhatsApp number

```
                 WACRM
                   │
        ┌──────────┼──────────┬──────────┐
    Channel 1   Channel 2   Channel 3   Channel 4    Meta limit per number:
        │          │          │          │           80 or 1 000 msg/s
        └──────── Redis ──────┴──────────┘           one token bucket each
                   │
                 Kafka  (campaign.sends, keyed by channel)
                   │
                Workers ── wait for a Redis slot, then send
                   │
              Meta Cloud API
```

Meta limits each **phone number**, not each campaign or server. With
`REDIS_URL` set, every campaign and every worker sending through a number
takes its slots from one shared bucket in Redis
(`src/lib/campaigns/channel-limiter.ts`):

- two campaigns on one 80/s number share 80/s (without Redis each would try
  80/s and Meta would reject the excess with 130429);
- ten workers draining Kafka together still send 80/s per number;
- a 130429 seen by any worker lowers that number's rate for all of them, and
  they recover together (the bucket settles just under the point where Meta
  throttled);
- different numbers never slow each other down.

Without `REDIS_URL` the same limiter runs inside each process (campaigns in
one process still share). If Redis goes down, workers log it once, pace
locally and reconnect on their own. Sending never stops because of Redis.

Redis stores nothing but the limiter state: one small hash per number,
expiring after an hour idle. No persistence or backup is needed.

### Amazon ElastiCache

1. Create an **ElastiCache for Redis OSS / Valkey** cluster (a single
   `cache.t4g.small` node is plenty: each worker makes about 100 small
   script calls per second per sending number), in the **same VPC** as the
   workers and MSK.
2. Security group: allow TCP 6379 from the app and worker security groups.
3. Turn on **in-transit encryption** (and an AUTH token if you want one),
   then set on the app and the workers:

   ```bash
   REDIS_URL=rediss://master.xxxx.cache.amazonaws.com:6379          # TLS
   REDIS_URL=rediss://:AUTH_TOKEN@master.xxxx.cache.amazonaws.com:6379
   ```

4. From inside the VPC: `npm run redis:check`. It pings Redis, paces 2 s at
   80/s through the shared limiter (expect ~160 slots) and lists the numbers
   currently sending, with their live rate and when Meta last throttled them.

## Local development

```bash
docker compose --profile kafka up -d kafka redis   # KRaft broker + Redis
echo 'KAFKA_BROKERS=localhost:9094' >> .env.local
echo 'REDIS_URL=redis://localhost:6379' >> .env.local
npm run dev                                     # consumers start in-process
```

`docker compose --profile kafka up -d` also starts the app and a worker
container (using `kafka:9092` and `redis://redis:6379` inside the compose
network).
