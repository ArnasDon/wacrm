-- Shared fixed-window rate limiting for horizontally scaled/serverless
-- deployments. Only SHA-256 bucket identifiers are persisted.

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_hash   text PRIMARY KEY
                CHECK (bucket_hash ~ '^[0-9a-f]{64}$'),
  request_count integer NOT NULL CHECK (request_count >= 0),
  reset_at      timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_reset_at
  ON rate_limit_buckets(reset_at);

ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_rate_limit_slot(
  p_bucket_hash text,
  p_limit integer,
  p_window_ms integer
)
RETURNS TABLE (
  success boolean,
  remaining integer,
  reset_at timestamptz,
  bucket_limit integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_bucket rate_limit_buckets%ROWTYPE;
BEGIN
  IF p_bucket_hash !~ '^[0-9a-f]{64}$'
     OR p_limit < 1
     OR p_limit > 1000000
     OR p_window_ms < 1
     OR p_window_ms > 86400000 THEN
    RAISE EXCEPTION 'invalid rate limit arguments'
      USING ERRCODE = '22023';
  END IF;

  -- Bounded opportunistic pruning keeps high-cardinality public buckets from
  -- growing forever. The one-day grace period is at least the maximum window.
  DELETE FROM rate_limit_buckets
  WHERE bucket_hash IN (
    SELECT stale.bucket_hash
    FROM rate_limit_buckets AS stale
    WHERE stale.reset_at < v_now - interval '1 day'
    ORDER BY stale.reset_at
    LIMIT 100
  );

  INSERT INTO rate_limit_buckets (
    bucket_hash,
    request_count,
    reset_at,
    updated_at
  )
  VALUES (
    p_bucket_hash,
    1,
    v_now + (p_window_ms * interval '1 millisecond'),
    v_now
  )
  ON CONFLICT (bucket_hash) DO UPDATE
  SET
    request_count = CASE
      WHEN rate_limit_buckets.reset_at <= v_now THEN 1
      ELSE LEAST(rate_limit_buckets.request_count + 1, p_limit + 1)
    END,
    reset_at = CASE
      WHEN rate_limit_buckets.reset_at <= v_now
        THEN v_now + (p_window_ms * interval '1 millisecond')
      ELSE rate_limit_buckets.reset_at
    END,
    updated_at = v_now
  RETURNING * INTO v_bucket;

  success := v_bucket.request_count <= p_limit;
  remaining := GREATEST(p_limit - v_bucket.request_count, 0);
  reset_at := v_bucket.reset_at;
  bucket_limit := p_limit;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON TABLE public.rate_limit_buckets FROM PUBLIC;
REVOKE ALL ON TABLE public.rate_limit_buckets FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_rate_limit_slot(text, integer, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_rate_limit_slot(text, integer, integer)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rate_limit_slot(text, integer, integer)
  TO service_role;
