-- Run these ONE AT A TIME before the first sync. Each answers a question the
-- customer_master.sql assumptions depend on.

-- 1) Which order statuses exist, and how much money is in each?
--    → decide the contents of `valid_statuses` in customer_master.sql
SELECT status, COUNT(*) AS orders, ROUND(SUM(amount), 0) AS sales,
       MIN(date_placed) AS first_seen, MAX(date_placed) AS last_seen
FROM `myecomlulu.jackpot.ksa_jackpot`
GROUP BY status ORDER BY orders DESC;

-- 2) Suspected shared / dummy phones, using the same rules as customer_master.sql
--    (> 3 different first names OR > 60 orders). Review the top of this list.
SELECT shipping_address_phone_number AS phone,
       COUNT(*) AS orders,
       COUNT(DISTINCT LOWER(TRIM(customer__first_name))) AS distinct_first_names,
       COUNT(DISTINCT LOWER(TRIM(customer__email))) AS distinct_emails,
       COUNT(DISTINCT DATE(date_placed)) AS active_days
FROM `myecomlulu.jackpot.ksa_jackpot`
WHERE LOWER(status) = 'delivered'
GROUP BY phone
HAVING COUNT(DISTINCT LOWER(TRIM(customer__first_name))) > 3 OR COUNT(*) > 60
ORDER BY orders DESC LIMIT 100;

-- 3) Does the item table join to the order table?
--    Expect a high match % for recent orders. Low % → the job_number
--    assumption is wrong and preferred store/category will be empty.
WITH o AS (
  SELECT CAST(number AS STRING) AS n FROM `myecomlulu.jackpot.ksa_jackpot`
  WHERE date_placed >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
),
i AS (
  SELECT DISTINCT REGEXP_EXTRACT(job_number, r'^Lulu-(\d+)') AS n
  FROM `myecomlulu.jackpot.instaleap_raw`
)
SELECT COUNT(*) AS orders_30d,
       COUNTIF(i.n IS NOT NULL) AS matched_to_items,
       ROUND(100 * COUNTIF(i.n IS NOT NULL) / COUNT(*), 1) AS match_pct
FROM o LEFT JOIN i ON o.n = i.n;

-- 4) Phone formats (length of the integer). Expect 12 digits starting 966.
SELECT LENGTH(CAST(shipping_address_phone_number AS STRING)) AS digits,
       SUBSTR(CAST(shipping_address_phone_number AS STRING), 1, 3) AS prefix,
       COUNT(*) AS orders
FROM `myecomlulu.jackpot.ksa_jackpot`
GROUP BY digits, prefix ORDER BY orders DESC LIMIT 20;

-- 6) The rows with NULL status (≈ 92k): what are they?
--    They have no amount and no date, so customer_master.sql ignores them.
--    Check whether they carry a phone / number and are real orders.
SELECT COUNT(*) AS rows_, COUNTIF(shipping_address_phone_number IS NOT NULL) AS with_phone,
       COUNTIF(number IS NOT NULL) AS with_number, COUNTIF(customer__email IS NOT NULL) AS with_email
FROM `myecomlulu.jackpot.ksa_jackpot` WHERE status IS NULL;

-- 7) Data window: is this a rolling window, or is older history somewhere else?
SELECT DATE_TRUNC(DATE(date_placed), MONTH) AS month, COUNT(*) AS orders,
       COUNT(DISTINCT shipping_address_phone_number) AS customers
FROM `myecomlulu.jackpot.ksa_jackpot` WHERE LOWER(status) = 'delivered'
GROUP BY month ORDER BY month;

-- 5) How many customers will the master produce?
--    (run customer_master.sql wrapped in SELECT COUNT(*) FROM ( ... ))

-- 8) Shapes of job_number. The customer master only understands 'Lulu-<digits>INP1'.
--    Any other shape here is a source of unmatched orders.
SELECT REGEXP_REPLACE(job_number, r'\d{6,}', '<N>') AS shape,
       COUNT(*) AS item_rows, COUNT(DISTINCT job_number) AS jobs,
       MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
FROM `myecomlulu.jackpot.instaleap_raw`
GROUP BY shape ORDER BY item_rows DESC LIMIT 20;

-- 9a) Which stores does the item table cover? (orders / jobs per store)
SELECT store_name_1 AS store, COUNT(DISTINCT job_number) AS jobs,
       MIN(DATE(created_at)) AS first_day, MAX(DATE(created_at)) AS last_day
FROM `myecomlulu.jackpot.instaleap_raw`
GROUP BY store ORDER BY jobs DESC LIMIT 30;

-- 9b) Item-table coverage by month vs the order table
WITH it AS (
  SELECT DATE_TRUNC(DATE(created_at), MONTH) AS month,
         COUNT(DISTINCT REGEXP_EXTRACT(job_number, r'(\d{9,})')) AS item_orders
  FROM `myecomlulu.jackpot.instaleap_raw` GROUP BY month
),
od AS (
  SELECT DATE_TRUNC(DATE(date_placed), MONTH) AS month, COUNT(*) AS orders
  FROM `myecomlulu.jackpot.ksa_jackpot` WHERE LOWER(status) = 'delivered' GROUP BY month
)
SELECT od.month, od.orders, it.item_orders, ROUND(100 * it.item_orders / od.orders, 1) AS pct
FROM od LEFT JOIN it USING (month) ORDER BY od.month;

-- 10) Which cities are matched / unmatched (last 30 days)?
WITH i AS (
  SELECT DISTINCT REGEXP_EXTRACT(job_number, r'(\d{9,})') AS n
  FROM `myecomlulu.jackpot.instaleap_raw`
)
SELECT o.shipping_address_city_name AS city, COUNT(*) AS orders,
       COUNTIF(i.n IS NOT NULL) AS matched,
       ROUND(100 * COUNTIF(i.n IS NOT NULL) / COUNT(*), 1) AS match_pct
FROM `myecomlulu.jackpot.ksa_jackpot` AS o
LEFT JOIN i ON CAST(o.number AS STRING) = i.n
WHERE o.date_placed >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY city ORDER BY orders DESC LIMIT 20;

-- 11) Freshness: when did the order table last receive data?
SELECT MAX(date_placed) AS latest_order, TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(date_placed), HOUR) AS hours_behind
FROM `myecomlulu.jackpot.ksa_jackpot`;

-- 12) Summary of the customer master. First save it as a view:
--       CREATE OR REPLACE VIEW `myecomlulu.jackpot.lulu_customer_master` AS
--       <paste customer_master.sql here, without the trailing ORDER BY / semicolon>;
--     (n8n can then simply SELECT * FROM that view.) Then run:
SELECT
  COUNT(*) AS customers,
  COUNTIF(suspect_reason IS NOT NULL) AS suspects,
  COUNTIF(suspect_reason IS NULL AND total_orders = 1) AS one_order_customers,
  COUNTIF(suspect_reason IS NULL AND total_orders >= 3) AS three_plus_orders,
  COUNTIF(vip_flag) AS vips,
  COUNTIF(preferred_store IS NOT NULL) AS with_store,
  ROUND(AVG(IF(suspect_reason IS NULL, total_orders, NULL)), 2) AS avg_orders
FROM `myecomlulu.jackpot.lulu_customer_master`;

-- 13) Why do only ~4% of customers have a preferred store (expected ~15%+ for the western region)?
--     Compare matched orders by item job_state, and how many have a store name.
WITH i AS (
  SELECT REGEXP_EXTRACT(job_number, r'^Lulu-(\d+)') AS n, job_state,
         ANY_VALUE(store_name_1) AS store
  FROM `myecomlulu.jackpot.instaleap_raw`
  GROUP BY n, job_state
)
SELECT i.job_state, COUNT(DISTINCT i.n) AS orders, COUNTIF(i.store IS NULL) AS without_store
FROM `myecomlulu.jackpot.ksa_jackpot` AS o
JOIN i ON CAST(o.number AS STRING) = i.n
WHERE LOWER(o.status) = 'delivered'
GROUP BY i.job_state ORDER BY orders DESC;
