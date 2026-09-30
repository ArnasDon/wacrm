// Last line of defence for long-running processes (the Next server's
// background work, the Kafka worker): an unhandled promise rejection or
// uncaught exception from one campaign / webhook must not take down the
// process and everything else it's doing. Log it loudly and keep going.
//
// Everything expected is already caught where it happens (senders never
// throw, consumers retry, writers retry); this only catches bugs.

const g = globalThis as unknown as { __wacrmGuards?: boolean };

export function installProcessGuards(name: string): void {
  if (g.__wacrmGuards) return;
  g.__wacrmGuards = true;
  process.on('unhandledRejection', (reason) => {
    console.error(
      `[${name}] unhandled promise rejection (process kept running):`,
      reason
    );
  });
  process.on('uncaughtException', (err, origin) => {
    console.error(
      `[${name}] uncaught exception from ${origin} (process kept running):`,
      err
    );
  });
}
