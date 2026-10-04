-- Run these ONE AT A TIME before the first sync. Each answers a question the
-- customer_master.sql assumptions depend on.

-- 1) Which order statuses exist, and how much money is in each?
--    → decide the contents of `valid_statuses` in customer_master.sql
SELECT status, COUNT(*) AS orders, ROUND(SUM(amount), 0) AS sales,
       MIN(date_placed) AS first_seen, MAX(date_placed) AS last_seen
FROM `myecomlulu.jackpot.ksa_jackpot`
GROUP BY status ORDER BY orders DESC;

-- 2) Shared / dummy phone numbers (many e-mails on one phone).
--    In the 10-row sample, one phone appears on 8 different e-mails.
SELECT shipping_address_phone_number AS phone,
       COUNT(*) AS orders,
       COUNT(DISTINCT customer__email) AS distinct_emails,
       COUNT(DISTINCT customer__first_name) AS distinct_first_names
FROM `myecomlulu.jackpot.ksa_jackpot`
GROUP BY phone
HAVING COUNT(DISTINCT customer__email) > 3
ORDER BY orders DESC LIMIT 50;

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

-- 5) How many customers will the master produce?
--    (run customer_master.sql wrapped in SELECT COUNT(*) FROM ( ... ))
