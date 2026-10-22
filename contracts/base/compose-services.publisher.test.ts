import { describe, it } from 'vitest';

// Publisher verification for interface I2 (slice CT.2).
// BASE.1 owns the docker-compose.yml these cases read; until it lands,
// the repo ships a single `app` service and there is nothing to verify.
// BASE.1 turns each `it.todo` into a real test (it also adds the YAML
// parser needed to read the compose file) — it must not delete them.
describe('publisher verification · docker-compose.yml satisfies CT.2 [pending BASE.1]', () => {
  it.todo(
    'reads docker-compose.yml and builds a ComposeTopology from its services and volumes'
  );
  it.todo('parses that topology with parseTopology without errors');
  it.todo('declares every required service of SERVICE_NAMES');
  it.todo('declares every volume of VOLUME_NAMES');
  it.todo('pins every image and uses :latest nowhere');
  it.todo('publishes no Postgres port (5432, 6543) on the host');
  it.todo('gives every service a healthcheck');
});
