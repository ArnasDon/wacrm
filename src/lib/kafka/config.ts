// ============================================================
// Kafka configuration (env) — Amazon MSK or any Kafka cluster.
//
//   KAFKA_BROKERS            comma-separated host:port list. Unset = Kafka
//                            off; everything runs in-process as before.
//   KAFKA_CLIENT_ID          default "wacrm"
//   KAFKA_SSL                "true" for TLS (MSK: always true)
//   KAFKA_SASL_MECHANISM     "aws-iam" (MSK IAM auth, port 9098),
//                            "scram-sha-512" (MSK SCRAM, port 9096),
//                            "scram-sha-256" or "plain"; unset = none
//   KAFKA_SASL_USERNAME / KAFKA_SASL_PASSWORD   for scram / plain
//   AWS_REGION               for aws-iam (credentials come from the
//                            default AWS chain: env, profile, ECS/EC2 role)
//   KAFKA_TOPIC_PREFIX       default "wacrm."
//   KAFKA_PARTITIONS         partitions for created topics, default 6
//   KAFKA_REPLICATION_FACTOR default -1 = broker default (MSK: 3)
//   KAFKA_WORKERS            "in-process" (default on a Node server) runs
//                            the consumers inside the app; "off" leaves
//                            them to `npm run worker:kafka`
// ============================================================

export type SaslMechanism =
  'aws-iam' | 'scram-sha-512' | 'scram-sha-256' | 'plain';

export interface KafkaSettings {
  brokers: string[];
  clientId: string;
  ssl: boolean;
  sasl: SaslMechanism | null;
  username: string | null;
  password: string | null;
  region: string | null;
  topicPrefix: string;
  partitions: number;
  replicationFactor: number;
}

const SASL: readonly SaslMechanism[] = [
  'aws-iam',
  'scram-sha-512',
  'scram-sha-256',
  'plain',
];

export function kafkaSettings(
  env: NodeJS.ProcessEnv = process.env
): KafkaSettings | null {
  const brokers = (env.KAFKA_BROKERS ?? '')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);
  if (brokers.length === 0) return null;

  const mech = (env.KAFKA_SASL_MECHANISM ?? '').trim().toLowerCase();
  const sasl = (SASL as readonly string[]).includes(mech)
    ? (mech as SaslMechanism)
    : null;
  const int = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n !== 0 ? n : d;
  };

  return {
    brokers,
    clientId: env.KAFKA_CLIENT_ID?.trim() || 'wacrm',
    // IAM auth only works over TLS; SCRAM on MSK too.
    ssl:
      env.KAFKA_SSL === 'true' ||
      sasl === 'aws-iam' ||
      sasl?.startsWith('scram') === true,
    sasl,
    username: env.KAFKA_SASL_USERNAME ?? null,
    password: env.KAFKA_SASL_PASSWORD ?? null,
    region: env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? null,
    topicPrefix: env.KAFKA_TOPIC_PREFIX ?? 'wacrm.',
    partitions: Math.max(1, int(env.KAFKA_PARTITIONS, 6)),
    replicationFactor: int(env.KAFKA_REPLICATION_FACTOR, -1),
  };
}

export const kafkaEnabled = () => kafkaSettings() !== null;

/** Topic names, prefixed so several environments can share a cluster. */
export function topics(prefix = kafkaSettings()?.topicPrefix ?? 'wacrm.') {
  return {
    campaignSends: `${prefix}campaign.sends`,
    webhookEvents: `${prefix}webhook.events`,
    webhookDeadLetter: `${prefix}webhook.events.dlq`,
    templateStatus: `${prefix}template.status`,
  };
}

/** Consumers run inside the app process unless turned off. */
export const inProcessWorkers = () =>
  kafkaEnabled() && (process.env.KAFKA_WORKERS ?? 'in-process') !== 'off';
