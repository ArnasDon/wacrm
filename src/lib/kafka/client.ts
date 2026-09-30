// Shared Kafka client, producer and topic setup. kafkajs is loaded
// lazily so nothing Kafka-related is imported (or connected) unless
// KAFKA_BROKERS is set.

import type { Admin, Kafka, KafkaConfig, Producer, SASLOptions } from 'kafkajs';

import { kafkaSettings, topics, type KafkaSettings } from './config';

const g = globalThis as unknown as {
  __wacrmKafka?: Kafka;
  __wacrmProducer?: Promise<Producer>;
  __wacrmTopicsReady?: Promise<void>;
};

async function saslOptions(s: KafkaSettings): Promise<SASLOptions | undefined> {
  if (!s.sasl) return undefined;
  if (s.sasl === 'aws-iam') {
    const { generateAuthToken } = await import('aws-msk-iam-sasl-signer-js');
    const region = s.region;
    if (!region)
      throw new Error('KAFKA_SASL_MECHANISM=aws-iam needs AWS_REGION');
    return {
      mechanism: 'oauthbearer',
      // Tokens last ~15 min; kafkajs asks again on re-auth.
      oauthBearerProvider: async () => {
        const { token } = await generateAuthToken({ region });
        return { value: token };
      },
    };
  }
  if (!s.username || !s.password) {
    throw new Error(
      `KAFKA_SASL_MECHANISM=${s.sasl} needs KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD`
    );
  }
  return {
    mechanism: s.sasl,
    username: s.username,
    password: s.password,
  } as SASLOptions;
}

export async function getKafka(): Promise<Kafka> {
  if (g.__wacrmKafka) return g.__wacrmKafka;
  const s = kafkaSettings();
  if (!s) throw new Error('Kafka is not configured (KAFKA_BROKERS)');
  const { Kafka, logLevel } = await import('kafkajs');
  const config: KafkaConfig = {
    clientId: s.clientId,
    brokers: s.brokers,
    ssl: s.ssl,
    sasl: await saslOptions(s),
    logLevel: logLevel.WARN,
    retry: { initialRetryTime: 300, retries: 8 },
  };
  g.__wacrmKafka = new Kafka(config);
  return g.__wacrmKafka;
}

/** Create the app's topics if they don't exist yet (idempotent). */
export function ensureTopics(): Promise<void> {
  g.__wacrmTopicsReady ??= (async () => {
    const s = kafkaSettings()!;
    const admin: Admin = (await getKafka()).admin();
    await admin.connect();
    try {
      const existing = new Set(await admin.listTopics());
      const wanted = Object.values(topics(s.topicPrefix)).filter(
        (t) => !existing.has(t)
      );
      if (wanted.length) {
        await admin.createTopics({
          waitForLeaders: true,
          topics: wanted.map((topic) => ({
            topic,
            numPartitions: s.partitions,
            replicationFactor: s.replicationFactor,
          })),
        });
      }
    } finally {
      await admin.disconnect();
    }
  })().catch((err) => {
    g.__wacrmTopicsReady = undefined;
    throw err;
  });
  return g.__wacrmTopicsReady;
}

/** One idempotent producer per process. */
export function getProducer(): Promise<Producer> {
  g.__wacrmProducer ??= (async () => {
    await ensureTopics();
    const producer = (await getKafka()).producer({
      idempotent: true,
      maxInFlightRequests: 5,
      allowAutoTopicCreation: false,
    });
    await producer.connect();
    return producer;
  })().catch((err) => {
    g.__wacrmProducer = undefined;
    throw err;
  });
  return g.__wacrmProducer;
}
