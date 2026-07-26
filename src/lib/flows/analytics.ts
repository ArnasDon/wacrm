import { z } from 'zod';

const utcTimestampSchema = z.string().datetime({ offset: true });
const nonNegativeInteger = z.number().int().nonnegative();
const nullableMetric = z.number().finite().nonnegative().nullable();
const nullableRate = z.number().finite().min(0).max(1).nullable();

export const flowAnalyticsNodeSchema = z.strictObject({
  node_key: z.string().min(1).max(200),
  node_type: z.string().min(1).max(100),
  entries: nonNegativeInteger,
  unique_runs: nonNegativeInteger,
  open: nonNegativeInteger,
  resolved: nonNegativeInteger,
  advanced: nonNegativeInteger,
  dropoff: nonNegativeInteger,
  completed: nonNegativeInteger,
  handed_off: nonNegativeInteger,
  advance_rate: nullableRate,
  dropoff_rate: nullableRate,
  avg_duration_ms: nullableMetric,
  avg_processing_ms: nullableMetric,
  next_nodes: z
    .array(
      z.strictObject({
        flow_version_id: z.string().uuid(),
        node_key: z.string().min(1).max(200),
        count: nonNegativeInteger,
      })
    )
    .max(500),
});

const flowVersionSummarySchema = z.strictObject({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  label: z.string().max(120).nullable(),
});

export const flowAnalyticsResponseSchema = z.strictObject({
  flow: z.strictObject({
    id: z.string().uuid(),
    name: z.string().min(1),
  }),
  version: flowVersionSummarySchema,
  available_versions: z.array(flowVersionSummarySchema).max(500),
  window: z.strictObject({
    from: utcTimestampSchema,
    to: utcTimestampSchema,
  }),
  coverage_started_at: utcTimestampSchema,
  coverage_cohort: z.literal('runs_started_after_tracking_enabled'),
  legacy_attempts_excluded: nonNegativeInteger,
  biggest_dropoff: flowAnalyticsNodeSchema.nullable(),
  nodes: z.array(flowAnalyticsNodeSchema).max(500),
});

export type FlowAnalyticsResponse = z.infer<typeof flowAnalyticsResponseSchema>;
export type FlowAnalyticsNode = z.infer<typeof flowAnalyticsNodeSchema>;

const querySchema = z
  .strictObject({
    version_id: z.string().uuid().optional(),
    from: utcTimestampSchema.optional(),
    to: utcTimestampSchema.optional(),
  })
  .superRefine((value, context) => {
    if ((value.from === undefined) !== (value.to === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'from and to must be provided together',
      });
      return;
    }
    if (!value.from || !value.to) return;
    const from = Date.parse(value.from);
    const to = Date.parse(value.to);
    if (to <= from) {
      context.addIssue({
        code: 'custom',
        message: 'to must be after from',
        path: ['to'],
      });
    } else if (to - from > 366 * 24 * 60 * 60 * 1000) {
      context.addIssue({
        code: 'custom',
        message: 'window cannot exceed 366 days',
        path: ['to'],
      });
    }
  });

export type FlowAnalyticsQuery = z.infer<typeof querySchema>;

export function parseFlowAnalyticsQuery(
  searchParams: URLSearchParams
): FlowAnalyticsQuery {
  const allowed = new Set(['version_id', 'from', 'to']);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1) {
      throw new Error('invalid analytics query');
    }
  }
  return querySchema.parse({
    version_id: searchParams.get('version_id') ?? undefined,
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  });
}
