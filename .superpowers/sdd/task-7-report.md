# Task 7 Report: Automation engine + builder UI

## Status

DONE_WITH_CONCERNS

## Implementation

- Added `move_deal_stage` execution in the automation engine. It validates pipeline/stage ids, resolves the relevant deal from the event conversation first and the contact's most recently updated open deal second, calls `moveDealStage` with `source: 'automation'`, and records the move detail in the automation log.
- Added `deal_stage_changed` chained dispatch after successful stage moves. The dispatch carries `deal_id` and increments `_stage_chain_depth`; it respects `MAX_STAGE_CHAIN_DEPTH` and logs a clear skipped-dispatch detail at the limit.
- Added `deal_id` to `AutomationContext` and the `deal_stage` condition, which checks the resolved deal's current `stage_id`.
- Added activation validation for `move_deal_stage`: both `pipeline_id` and `stage_id` are required.
- Completed builder support for the step, trigger, and condition: the step uses the existing pipeline/stage selector, `deal_stage_changed` is selectable, and `deal_stage` uses a pipeline-grouped stage picker with a raw-id fallback.
- Added English and Korean labels/hints.
- Preserved and included the pre-existing `deal_stage_changed` entry in `TRIGGER_META`, resolving its exhaustive `AutomationTriggerType` record error.

## TDD Evidence

1. Added focused engine tests for a successful move, no linked deal no-op, and a positive `deal_stage` condition branch before engine implementation.
2. Initial required engine test invocation failed before test evaluation because the Vitest worker exhausted its 4 GB heap. Investigation found the new condition test exposed a test-double defect: the `automation_steps` mock returned root condition rows for child-branch queries, causing unbounded recursion. The mock now honors `parent_step_id`.
3. After the mock correction and implementation, `npx vitest run src/lib/automations/engine.test.ts` passed: 1 file, 17 tests.
4. Added the two required validation tests before adding the validation case. The initial validation run failed as expected: a complete `move_deal_stage` step was reported as an unknown step type. After implementation, it passed.

## Verification

| Command | Result |
| --- | --- |
| `npx vitest run src/lib/automations/engine.test.ts` | PASS - 1 file, 17 tests |
| `npx vitest run src/lib/automations/validate.test.ts` | PASS - 1 file, 23 tests |
| `npx vitest run src/lib/automations/` | PASS - 2 files, 40 tests |
| `npx tsc --noEmit` | PASS - 0 errors |
| `git diff --check` | PASS - no whitespace errors |

## Files Changed

- `src/lib/automations/engine.ts`
- `src/lib/automations/engine.test.ts`
- `src/lib/automations/validate.ts`
- `src/lib/automations/validate.test.ts`
- `src/components/automations/automation-builder.tsx`
- `src/lib/automations/trigger-meta.ts`
- `messages/en.json`
- `messages/ko.json`
- `.superpowers/sdd/task-7-report.md`

## Self-Review

- The deal resolver scopes both conversation and contact lookups by `account_id`; the contact fallback also requires `status = 'open'` and orders by `updated_at DESC`.
- A missing deal returns a successful no-op detail instead of failing the automation, matching the task contract.
- The existing client component boundary remains intact; no server-only dependency was introduced into the builder.
- `deal_stage_changed` intentionally has no activation validation requirements because its filter is optional.
- No unrelated changes were staged: `package-lock.json` remains modified and `supabase/.temp/` remains untracked.

## Concern

Manual browser verification of `/automations/new` could not be completed because this environment rejected both permitted background dev-server launch mechanisms before a listener could be started. The UI is covered by `npx tsc --noEmit`, but its runtime dropdown interaction was not browser-verified in this run.

## Reviewer Fix

- Reviewer finding fixed: the `deal_stage` condition query now explicitly scopes the deal lookup by `account_id` before `maybeSingle()`.
- Files changed: `src/lib/automations/engine.ts`, `src/lib/automations/engine.test.ts`, `.superpowers/sdd/task-7-report.md`.
- Commands run and results: `npx vitest run src/lib/automations/engine.test.ts` - PASS, 1 file and 17 tests; `npx tsc --noEmit` - PASS, exit code 0 with no errors.
- Commit: `fix(automations): scope deal stage condition by account` (SHA recorded after commit).
