-- ============================================================
-- 057: System details in the campaign speed log
--
-- Per second, per channel, per worker process (see
-- src/lib/campaigns/speed-log.ts):
--   worker / role / path   which process sent (host:pid), app server or
--                          Kafka worker, Kafka or in-process sending
--   in_flight / max_in_flight   requests open to Meta vs the cap
--   tier_rate / cap_rate   the number's Meta tier and the campaign cap
--                          (limit_rate, from 056, is the limiter's pace)
--   rss_mb / heap_mb / cpu_pct / load_avg / event_loop_lag_ms
--                          that worker's memory, CPU, machine load and
--                          event-loop lag, sampled once a second
-- ============================================================

ALTER TABLE public.campaign_speed_log
  ADD COLUMN IF NOT EXISTS worker            TEXT,
  ADD COLUMN IF NOT EXISTS role              TEXT,
  ADD COLUMN IF NOT EXISTS path              TEXT,
  ADD COLUMN IF NOT EXISTS in_flight         INTEGER,
  ADD COLUMN IF NOT EXISTS max_in_flight     INTEGER,
  ADD COLUMN IF NOT EXISTS tier_rate         NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS cap_rate          NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS rss_mb            NUMERIC(10, 1),
  ADD COLUMN IF NOT EXISTS heap_mb           NUMERIC(10, 1),
  ADD COLUMN IF NOT EXISTS cpu_pct           NUMERIC(7, 1),
  ADD COLUMN IF NOT EXISTS load_avg          NUMERIC(7, 2),
  ADD COLUMN IF NOT EXISTS event_loop_lag_ms NUMERIC(9, 1);
