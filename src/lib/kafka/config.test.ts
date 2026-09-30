import { describe, expect, it } from 'vitest';

import { kafkaSettings, topics } from './config';

const env = (vars: Record<string, string>) =>
  vars as unknown as NodeJS.ProcessEnv;

describe('kafkaSettings', () => {
  it('is off without brokers', () => {
    expect(kafkaSettings(env({}))).toBeNull();
    expect(kafkaSettings(env({ KAFKA_BROKERS: ' , ' }))).toBeNull();
  });

  it('parses a plain local broker', () => {
    expect(
      kafkaSettings(env({ KAFKA_BROKERS: 'localhost:9094' }))
    ).toMatchObject({
      brokers: ['localhost:9094'],
      clientId: 'wacrm',
      ssl: false,
      sasl: null,
      topicPrefix: 'wacrm.',
      partitions: 6,
      replicationFactor: -1,
    });
  });

  it('MSK IAM implies TLS and needs the region', () => {
    const s = kafkaSettings(
      env({
        KAFKA_BROKERS: 'b-1.msk.aws:9098,b-2.msk.aws:9098',
        KAFKA_SASL_MECHANISM: 'AWS-IAM',
        AWS_REGION: 'ap-south-1',
      })
    );
    expect(s).toMatchObject({
      brokers: ['b-1.msk.aws:9098', 'b-2.msk.aws:9098'],
      sasl: 'aws-iam',
      ssl: true,
      region: 'ap-south-1',
    });
  });

  it('MSK SCRAM uses TLS and credentials', () => {
    expect(
      kafkaSettings(
        env({
          KAFKA_BROKERS: 'b-1:9096',
          KAFKA_SASL_MECHANISM: 'scram-sha-512',
          KAFKA_SASL_USERNAME: 'u',
          KAFKA_SASL_PASSWORD: 'p',
          KAFKA_PARTITIONS: '12',
        })
      )
    ).toMatchObject({
      sasl: 'scram-sha-512',
      ssl: true,
      username: 'u',
      password: 'p',
      partitions: 12,
    });
  });

  it('prefixes topic names', () => {
    expect(topics('prod.')).toEqual({
      campaignSends: 'prod.campaign.sends',
      webhookEvents: 'prod.webhook.events',
      webhookDeadLetter: 'prod.webhook.events.dlq',
      templateStatus: 'prod.template.status',
    });
  });
});
