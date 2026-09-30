/**
 * Kafka health check — `npm run kafka:check`.
 *
 * Connects with the app's settings (.env.local or the environment) and
 * prints: the connection settings (no secrets), whether each app topic
 * exists with its partition count and message count, and each consumer
 * group's state, members and lag. Lag that stays above 0 while workers run
 * means the consumers aren't keeping up (or aren't running).
 *
 * Exit code 0 = connected and all topics present, 1 = a problem.
 */
try {
  process.loadEnvFile('.env.local');
} catch {
  // environment comes from the shell / container
}

async function main() {
  const { kafkaSettings, topics } = await import('@/lib/kafka/config');
  const s = kafkaSettings();
  if (!s) {
    console.log('✗ KAFKA_BROKERS is not set — the app runs without Kafka.');
    process.exit(1);
  }
  console.log('Settings');
  console.log(`  brokers      ${s.brokers.join(', ')}`);
  console.log(
    `  auth         ${s.sasl ?? 'none'}${s.ssl ? ' + TLS' : ''}${s.sasl === 'aws-iam' ? ` (region ${s.region ?? '—'})` : ''}`
  );
  console.log(`  topic prefix ${s.topicPrefix}`);

  const { getKafka } = await import('@/lib/kafka/client');
  const admin = (await getKafka()).admin();
  try {
    await Promise.race([
      admin.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timed out after 15 s')), 15_000)
      ),
    ]);
  } catch (err) {
    console.log(
      `\n✗ Cannot connect: ${err instanceof Error ? err.message : err}`
    );
    console.log(
      '  Check the broker addresses/ports, security group / network, and auth settings.'
    );
    process.exit(1);
  }
  console.log('\n✓ Connected');

  let ok = true;
  const t = topics(s.topicPrefix);
  const existing = new Set(await admin.listTopics());
  console.log('\nTopics');
  for (const topic of Object.values(t)) {
    if (!existing.has(topic)) {
      console.log(`  ✗ ${topic} — missing (the app creates it on first use)`);
      ok = false;
      continue;
    }
    const offsets = await admin.fetchTopicOffsets(topic);
    const total = offsets.reduce(
      (sum, p) => sum + (Number(p.high) - Number(p.low)),
      0
    );
    console.log(
      `  ✓ ${topic} — ${offsets.length} partitions, ${total} messages retained`
    );
  }

  const { groups } = await admin.listGroups();
  const ours = groups.filter((g) => g.groupId.startsWith(s.topicPrefix));
  console.log('\nConsumer groups');
  if (ours.length === 0) console.log('  (none yet — no worker has connected)');
  const described = ours.length
    ? await admin.describeGroups(ours.map((g) => g.groupId))
    : { groups: [] };
  for (const g of described.groups) {
    let lag = 0;
    for (const topic of Object.values(t)) {
      if (!existing.has(topic)) continue;
      const [committed] = await admin.fetchOffsets({
        groupId: g.groupId,
        topics: [topic],
      });
      const high = await admin.fetchTopicOffsets(topic);
      for (const p of committed?.partitions ?? []) {
        const end = Number(
          high.find((h) => h.partition === p.partition)?.high ?? 0
        );
        const at = Number(p.offset);
        if (at >= 0) lag += Math.max(0, end - at);
      }
    }
    console.log(
      `  ${g.state === 'Stable' ? '✓' : '•'} ${g.groupId} — ${g.state}, ${g.members.length} member(s), lag ${lag}`
    );
  }

  await admin.disconnect();
  console.log(
    ok
      ? '\nAll good.'
      : '\nSome topics are missing — start the app or a worker once to create them.'
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('✗', err instanceof Error ? err.message : err);
  process.exit(1);
});

// Module scope (keeps `main` local to this file).
export {};
