-- ============================================================
-- LuLu customer master  →  feeds POST /api/v1/lulu/customers/sync
--
-- Sources
--   myecomlulu.jackpot.ksa_jackpot     one row per order (phone, name, amount, status)
--   myecomlulu.jackpot.instaleap_raw   one row per order item (store, category, price)
--
-- Output: ONE ROW PER CUSTOMER, column names match the sync API exactly,
-- so n8n needs no field mapping.
--
-- Assumptions (verify with diagnostics.sql BEFORE trusting the output)
--   1. No customer_id exists → the normalised phone number IS the customer id.
--   2. Only orders with status in `valid_statuses` count as purchases.
--   3. instaleap_raw.job_number = 'Lulu-<order number>INP1' → order number
--      is extracted and joined to ksa_jackpot.number (used ONLY for
--      preferred store / category; everything else works without the join).
--   4. Phones used by many different e-mails are shared/dummy numbers and
--      are excluded (otherwise many people collapse into one "customer").
--   5. Categories come out as 3-digit department CODES (e.g. '006'); a
--      code → name lookup table is needed to show names.
--   6. Not available in these tables → not emitted: birthday, loyalty_id,
--      marketing_opt_in, language (defaults to 'ar'), active_complaint.
-- ============================================================
WITH params AS (
  SELECT
    ['delivered'] AS valid_statuses,   -- add other "completed" status values if any
    5    AS max_emails_per_phone,      -- phones above this are treated as shared
    0.05 AS vip_top_share,             -- top 5% by lifetime sales ...
    3    AS vip_min_orders,            -- ... with at least 3 orders
    180  AS item_lookback_days,        -- window for preferred store/category
    'Asia/Riyadh' AS tz
),

orders_raw AS (
  SELECT
    CAST(o.shipping_address_phone_number AS STRING) AS phone,
    o.number AS order_number,
    o.amount,
    o.date_placed,
    DATE(o.date_placed, p.tz) AS order_date,
    LOWER(TRIM(o.customer__email)) AS email,
    NULLIF(TRIM(CONCAT(IFNULL(o.customer__first_name, ''), ' ', IFNULL(o.customer__last_name, ''))), '') AS full_name
  FROM `myecomlulu.jackpot.ksa_jackpot` AS o
  CROSS JOIN params AS p
  WHERE o.shipping_address_phone_number IS NOT NULL
    AND o.number IS NOT NULL
    AND o.date_placed IS NOT NULL
    AND LOWER(o.status) IN UNNEST(p.valid_statuses)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.number ORDER BY o.date_placed DESC) = 1
),

shared_phones AS (
  SELECT phone
  FROM orders_raw
  GROUP BY phone
  HAVING COUNT(DISTINCT email) > (SELECT max_emails_per_phone FROM params)
),

orders AS (
  SELECT * FROM orders_raw
  WHERE phone NOT IN (SELECT phone FROM shared_phones)
),

-- Personal purchase cycle, measured between distinct order DAYS so two
-- orders on the same day don't produce a 0-day "cycle".
order_days AS (
  SELECT DISTINCT phone, order_date FROM orders
),
gaps AS (
  SELECT
    phone,
    DATE_DIFF(order_date, LAG(order_date) OVER (PARTITION BY phone ORDER BY order_date), DAY) AS gap_days
  FROM order_days
),
cycle AS (
  SELECT
    phone,
    APPROX_QUANTILES(gap_days, 100)[OFFSET(50)] AS median_interval_days,
    ROUND(STDDEV_POP(gap_days), 2) AS stddev_interval_days
  FROM gaps
  WHERE gap_days IS NOT NULL
  GROUP BY phone
),

cust AS (
  SELECT
    phone,
    COUNT(*) AS total_orders,
    ROUND(SUM(amount), 2) AS total_sales,
    ROUND(AVG(amount), 2) AS average_order_value,
    MIN(order_date) AS first_order_date,
    MAX(order_date) AS last_order_date,
    COUNTIF(order_date >= DATE_SUB(CURRENT_DATE((SELECT tz FROM params)), INTERVAL 30 DAY)) AS orders_30d,
    COUNTIF(order_date >= DATE_SUB(CURRENT_DATE((SELECT tz FROM params)), INTERVAL 90 DAY)) AS orders_90d,
    ARRAY_AGG(full_name IGNORE NULLS ORDER BY date_placed DESC LIMIT 1)[SAFE_OFFSET(0)] AS name
  FROM orders
  GROUP BY phone
),

-- Item-level facts (preferred store / category). Raw table may hold several
-- versions of the same item row → keep the latest per id.
items AS (
  SELECT
    REGEXP_EXTRACT(i.job_number, r'^Lulu-(\d+)') AS order_number_str,
    i.store_name_1 AS store,
    SUBSTR(SAFE.JSON_VALUE(i.attributes, '$.category'), 1, 3) AS dept,
    IFNULL(i.price, 0) * IFNULL(i.found_quantity, 0) AS item_sales
  FROM `myecomlulu.jackpot.instaleap_raw` AS i
  CROSS JOIN params AS p
  WHERE i.created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL p.item_lookback_days DAY)
    AND i.job_state = 'FINISHED'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY i.id ORDER BY i.updated_at DESC) = 1
),
joined AS (
  SELECT o.phone, o.order_number, it.store, it.dept, it.item_sales
  FROM orders AS o
  JOIN items AS it ON CAST(o.order_number AS STRING) = it.order_number_str
),
pref_store AS (
  SELECT phone, store AS preferred_store
  FROM (
    SELECT phone, store, COUNT(DISTINCT order_number) AS n
    FROM joined
    WHERE store IS NOT NULL
    GROUP BY phone, store
  )
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (PARTITION BY phone ORDER BY n DESC, store) = 1
),
pref_dept AS (
  SELECT phone, dept AS preferred_category
  FROM (
    SELECT phone, dept, SUM(item_sales) AS spend
    FROM joined
    WHERE dept IS NOT NULL
    GROUP BY phone, dept
  )
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (PARTITION BY phone ORDER BY spend DESC, dept) = 1
),

scored AS (
  SELECT
    c.*,
    NTILE(5) OVER (ORDER BY c.last_order_date ASC) AS rfm_recency,   -- 5 = most recent
    NTILE(5) OVER (ORDER BY c.total_orders ASC)    AS rfm_frequency, -- 5 = most orders
    NTILE(5) OVER (ORDER BY c.total_sales ASC)     AS rfm_monetary,  -- 5 = highest spend
    PERCENT_RANK() OVER (ORDER BY c.total_sales ASC) AS sales_pct
  FROM cust AS c
)

SELECT
  s.phone                                   AS customer_id,
  s.phone                                   AS mobile,            -- API normalises 966… / 05… to +966…
  s.name,
  'ar'                                      AS language,          -- no language source yet
  CAST(s.first_order_date AS STRING)        AS first_order_date,
  CAST(s.last_order_date AS STRING)         AS last_order_date,
  s.total_orders,
  s.total_sales,
  s.average_order_value,
  s.orders_30d,
  s.orders_90d,
  cy.median_interval_days,
  cy.stddev_interval_days,
  ps.preferred_store,
  pd.preferred_category,
  CASE
    WHEN s.total_orders = 1                          THEN 'New'
    WHEN s.rfm_recency >= 4 AND s.rfm_frequency >= 4 THEN 'Champions'
    WHEN s.rfm_frequency >= 4                        THEN 'Loyal'
    WHEN s.rfm_recency >= 4                          THEN 'Potential Loyalist'
    WHEN s.rfm_recency <= 2 AND s.rfm_frequency >= 3 THEN 'At Risk'
    WHEN s.rfm_recency = 1                           THEN 'Lost'
    ELSE 'Needs Attention'
  END                                       AS customer_segment,
  s.rfm_recency,
  s.rfm_frequency,
  s.rfm_monetary,
  s.total_sales                             AS lifetime_value,
  (s.sales_pct >= 1 - (SELECT vip_top_share FROM params)
     AND s.total_orders >= (SELECT vip_min_orders FROM params)) AS vip_flag
FROM scored AS s
LEFT JOIN cycle      AS cy ON cy.phone = s.phone
LEFT JOIN pref_store AS ps ON ps.phone = s.phone
LEFT JOIN pref_dept  AS pd ON pd.phone = s.phone
ORDER BY s.phone;
