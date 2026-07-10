import { ensureDefaultPipeline } from "./pipeline";
import { ensureDefaultAutomations } from "./automations";
import { ensureDefaultFlows } from "./flows";

export async function ensureAccountBootstrap(args: {
  accountId: string;
  userId: string;
}) {
  const { accountId, userId } = args;

  // Create Sales Pipeline + Stages
  await ensureDefaultPipeline(accountId, userId);

  console.log("[BOOTSTRAP] Pipeline START");
await ensureDefaultPipeline(accountId, userId);
console.log("[BOOTSTRAP] Pipeline DONE");

  // Create default automations
  await ensureDefaultAutomations(accountId, userId);

  console.log("[BOOTSTRAP] Pipeline START");
await ensureDefaultPipeline(accountId, userId);
console.log("[BOOTSTRAP] Pipeline DONE");

  // Next step
  await ensureDefaultFlows(accountId, userId);

  console.log("[BOOTSTRAP] Pipeline START");
await ensureDefaultPipeline(accountId, userId);
console.log("[BOOTSTRAP] Pipeline DONE");

}