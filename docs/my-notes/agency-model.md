# q: can i run it as agency model via my selfhosted solution ?
Yes, you can run an agency model using this setup, but there is a major architectural catch you must understand first.
Out of the box, [ArnasDon/wacrm](https://github.com/ArnasDon/wacrm) is built as a single-tenant software framework. It provides a single shared inbox tied to a single WhatsApp Business number managed by one team. It does not have a native "SaaS agency dashboard" where Client A logs in and is completely walled off from Client B's data. [1, 2, 3] 
If you want to offer this to your agency clients, you have two choices for how to structure your self-hosted setup:
## Strategy 1: The Multi-Instance Approach (Recommended & Easiest)
Instead of trying to force multiple clients into one piece of software, you deploy a completely separate, isolated combination of wacrm + Supabase for each individual client. [4] 
If you use a self-hosted PaaS tool like Coolify, this setup scales efficiently:

* 
* White-Labeling: You fork the wacrm repository, strip out the original branding, change the colors, and replace the logos with your own agency branding. [1] 
* Client Isolation: Every client gets their own dedicated sub-domain (e.g., ://youragency.com), their own isolated Supabase database instance, and their own Meta Cloud API webhook connection.
* Security & Clean Management: If one client sends spam and gets their phone number suspended by Meta, or if their database experiences high volume, none of your other agency clients are affected. [3, 5] 
* Monetization: You can charge clients a flat setup fee ($100–$300) plus a monthly maintenance subscription fee, while your infrastructure costs remain minimal.
* 

## Strategy 2: Rewrite the Source Code into True Multi-Tenancy
If you want a single website portal (://youragency.com) where you manage billing and clients log into partitioned accounts, you will need to heavily modify the underlying codebase. [6] 
To convert the template into a multi-tenant application, you must handle three key tasks:

   1. Database Refactoring: You need to inject a tenant_id column into every table (contacts, messages, pipelines, users) and configure strict Supabase Row-Level Security (RLS) policies. This ensures a query can only fetch data where tenant_id == auth.jwt() -> tenant_id. [3, 7] 
   2. Dynamic Credential Storage: The standard template reads Meta WhatsApp API tokens from system environment variables (.env). You must delete these variables and build an encrypted database table that stores and rotates distinct WABA_ID, PHONE_NUMBER_ID, and ACCESS_TOKEN strings for each client. [6] 
   3. Webhook Multiplexing Router: Meta only sends inbound WhatsApp messages to a single webhook URL. You will need to write a custom gateway endpoint that intercepts all incoming payloads, reads the unique phone_number_id inside the message JSON, matches it to the correct client ID, and forks the event down to that client's inbox. [5, 6, 8] 

## The Practical Verdict

* 
* Go with Strategy 1 (Multi-Instance Cloning) if you want to launch quickly. You can spin up new instances using automated git-deploys in under 15 minutes per client without touching a single line of backend logic.
* Go with Strategy 2 (Code Overhaul) only if you are an experienced software engineer intending to build a commercial SaaS startup and have the time to rewrite core application layers. [7] 
* 

Would you like help designing a shell script to spin up new database instances quickly, or do you want to look at how to set up individual Meta Developer Apps for your clients? [9] 

[1] [https://github.com](https://github.com/ArnasDon/wacrm)
[2] [https://www.ictbroadcast.com](https://www.ictbroadcast.com/difference-between-multi-user-multi-tenant-software/)
[3] [https://www.syedamaan.com](https://www.syedamaan.com/writing/building-multi-tenant-whatsapp-backend)
[4] [https://owncloud.com](https://owncloud.com/blogs/blog-multi-tenancy-owncloud/)
[5] [https://leadnotifi.com](https://leadnotifi.com/articles/build-multi-tenant-saas-whatsapp-cloud-api)
[6] [https://leadnotifi.com](https://leadnotifi.com/articles/build-multi-tenant-saas-whatsapp-cloud-api)
[7] [https://wasenderapi.com](https://wasenderapi.com/blog/how-to-build-a-multi-tenant-whatsapp-api-architecture-for-saas-and-agencies)
[8] [https://github.com](https://github.com/ArnasDon/wacrm)
[9] [https://zeromsg.com](https://zeromsg.com/en/self-hosted)

# q: for a small business how long the supabase hosted free tier  enough

For a small business running the ArnasDon/wacrm template, the cloud-hosted [Supabase](https://supabase.com/pricing) free tier will typically last between 1 to 3 months before forcing a paid upgrade, depending entirely on your conversation volume. [1, 2] 
While it has no hard expiration date, the structural resource constraints will become a barrier as the business operates. [3] 
------------------------------
## The Real Cap: 500 MB Database Storage
The free tier gives you exactly 500 MB of PostgreSQL database storage. In a WhatsApp CRM, this space is consumed by textual data: [2, 4, 5] 

* 
* What eats the storage: Text messages, webhook metadata logs, inbound client profiles, contact tags, and Kanban sales card historical states. [5] 
* The Math: An average text message thread payload (including Meta metadata, timestamps, and row relations) consumes roughly 2 KB to 4 KB of database space.
* The Lifespan: 500 MB holds approximately 120,000 to 150,000 text messages total. If your small business handles 2,000 messages a day (inbound + outbound), you will completely fill the free tier database in about 60 to 75 days.
* 

------------------------------
## The Hidden Trap: Inactivity Auto-Pausing
If your business goes a single week without a transaction—such as over a holiday closing or a slow low-season stretch—Supabase will automatically freeze and pause your free instance. [2, 6] 

* 
* The Consequences: When paused, the connection drops, causing Meta’s incoming WhatsApp webhooks to fail immediately.
* The Fix: While you can manually log into the Supabase Studio dashboard to restore the project, your business will experience operational downtime until it fully resumes. [6, 7, 8] 
* 

------------------------------
## Other Free Tier Metrics (And How They Apply to wacrm)

* 
* 1 GB File Storage: Highly restrictive for a CRM. If your clients frequently send multi-page PDFs, voice notes, screenshots, or receipts over WhatsApp, this 1 GB cap will fill up in less than 30 days. [4, 9] 
* 5 GB Outbound Bandwidth (Egress): Generally sufficient. Since your support agents are mostly reading text dashboards, 5 GB of monthly data transmission handles small business demands easily unless heavy media streaming occurs. [2, 4] 
* 50,000 Monthly Active Users (MAU): More than enough. This limit applies strictly to registered team agents logging into the CRM dashboard via Supabase Auth, not the external customers chatting with you over WhatsApp. [2, 4, 10] 
* 

------------------------------
## The Cost of Outgrowing It
Once you cross any of these thresholds, Supabase does not cut you off instantly; instead, it prompts an upgrade to the Pro Plan at $25/month. This raises your limits immediately to an 8 GB database, 100 GB file storage, and 250 GB of egress bandwidth, while eliminating the auto-pausing behavior completely. [2, 11] 
If you want to stretch the free tier as long as possible, would you like to review how to configure an external S3-compatible bucket (like Cloudflare R2) to offload media files, or should we look at setting up a database pruning script to clear old logs?

[1] [https://www.buildmvpfast.com](https://www.buildmvpfast.com/blog/supabase-pricing-hidden-costs-scale-alternatives-2026)
[2] [https://makerkit.dev](https://makerkit.dev/blog/saas/supabase-pricing)
[3] [https://butterbase.ai](https://butterbase.ai/blog/supabase-pricing-2026)
[4] [https://www.itpathsolutions.com](https://www.itpathsolutions.com/supabase-free-tier-limits)
[5] [https://aiagencyplus.com](https://aiagencyplus.com/supabase-free-tier-limits/)
[6] [https://supabase.com](https://supabase.com/docs/guides/platform/free-project-pausing)
[7] [https://levelup.gitconnected.com](https://levelup.gitconnected.com/supabase-free-tier-will-pause-your-app-heres-the-github-actions-fix-8c1fd35b49ca)
[8] [https://simplebackups.com](https://simplebackups.com/blog/supabase-free-tier-paused)
[9] [https://lumsx-bbb.lums.edu.pk](https://lumsx-bbb.lums.edu.pk/fast-dispatch/supabases-free-tier-what-you-need-to-know-1764797444)
[10] [https://aiagencyplus.com](https://aiagencyplus.com/keep-your-supabase-free-tier-project-live-past-the-limit/)
[11] [https://www.metacto.com](https://www.metacto.com/blogs/the-true-cost-of-supabase-a-comprehensive-guide-to-pricing-integration-and-maintenance)

# q: how many clients (nextjs + supabase selfhosted)  can i server from my this one Hetzner vps cloud package: CX33 4 Intel®/AMD 8 GB 80 GB max. $ 10.59 /month $ 0.0170 /hour

On your Hetzner CX33 VPS (4 vCPUs, 8 GB RAM, 80 GB SSD), you can comfortably host 3 to 5 active clients simultaneously using the multi-instance deployment strategy (isolated Next.js frontend + complete Supabase backend stack per client). [1] 
If you configure extreme container optimizations or migrate to a shared-database architecture, you can scale that up to 10 to 15 clients on this single machine.
## Resource Bottlenecks Explained## 🧠 RAM (The Hardest Limit) — Maximum 3 to 5 Clients (Standard Setup)
RAM is your primary constraint. A standard vanilla deployment of the Supabase open-source Docker stack orchestrates roughly 12 separate microservice containers (Kong, GoTrue, PostgREST, Realtime, Storage, Studio, Postgres, Vector, etc.).

* 
* Per Client Base Overhead: Each idling client Supabase stack requires roughly 1.2 GB to 1.5 GB of RAM just to keep the services alive.
* The Math: Running 4 clients baseline takes $4 \times 1.3\text{ GB} = 5.2\text{ GB}$. Adding 4 lightweight Next.js frontends ($\approx 150\text{ MB}$ each = $600\text{ MB}$) plus the Host OS and Reverse Proxy (Coolify/Traefik $\approx 1\text{ GB}$) puts your total utilization around 6.8 GB RAM. Pushing past 5 clients on raw defaults will trigger your Linux Out-Of-Memory (OOM) killer and crash the server.
* 

## 💾 SSD Storage (The Content Limit) — Maximum 5 to 8 Clients

* 
* Base Footprint: A single deployed instance of Next.js and Supabase images takes up about 4 GB to 5 GB of disk space for Docker image storage layers. 5 clients will eat up 25 GB just in system software files.
* Database & Assets: This leaves you 55 GB of breathing room. If your clients store structural text history and small logs, it is fine. However, if they receive heavy media (WhatsApp images, voice notes, PDFs), your 80 GB disk will fill up rapidly.
* 

## ⚙️ CPU (The Processing Limit) — More than 10 Clients
With 4 dedicated vCPUs, CPU capacity will rarely bottleneck your ecosystem. Messaging apps experience "burst" traffic patterns. Unless all your clients trigger massive automated broadcast campaigns to 50,000 leads at the exact same microsecond, your CPUs will mostly idle.
------------------------------
## How to Double Your Capacity (From 4 to 12+ Clients)
If you want to maximize your $10.59/month Hetzner package and fit more than 10 clients on it, implement these critical engineering configurations:

   1. Offload Storage Immediately: Do not save media files (images, audio, files) directly onto the Hetzner local disk. Configure [Supabase Storage](https://supabase.com/pricing) to stream object assets directly to [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) or [Backblaze B2](https://www.backblaze.com/cloud-storage). Both offer massive free tiers, reducing your Hetzner SSD utilization down to near-zero.
   2. Aggressively Restrict Docker RAM: By default, Docker containers will grab as much memory as they want. Edit your docker-compose or Coolify configurations to enforce hard memory limits on non-essential services. Restrict the Supabase Studio dashboard container to 64MB, GoTrue to 128MB, and Kong to 64MB.
   3. Transition to Shared Multi-Tenancy: Instead of spinning up 12 separate Supabase instances (which means running 12 independent copy clusters of Postgres, Auth, and Realtime), invest the development time to rewrite wacrm with a tenant_id column. Running one highly optimized Supabase instance serving 15 partitioned client frontends will lower your idle memory use from 8 GB down to less than 2.5 GB.

## Restating the Capacity## ✅ Expected Performance Capacity
Under standard multi-instance separation rules with basic media offloading, a Hetzner CX33 server can reliably support 4 independent small-business clients without resource exhaustion or system degradation.
Would you like help setting up a Docker Compose template that enforces strict RAM limitations per container, or should we look at how to safely connect an external S3 storage bucket to protect your local disk space?

[1] [https://sparecores.com](https://sparecores.com/server/hcloud/cx33)

# q: add 4th point:  setting up a database pruning script to clear old logs?

Implementing a database pruning script is the single most effective way to protect your limited 80 GB Hetzner SSD space.
In a WhatsApp CRM like wacrm, inbound webhook raw logs, system events, and chat message delivery receipts generate millions of data rows that do not need to be stored forever. Clearing out data older than 30 or 60 days keeps your database compact, ensures indexes fit entirely within your 8 GB RAM, and prevents performance degradation.
------------------------------
## Step-by-Step Implementation Guide
To automate this on your self-hosted instance without manually running SQL queries, configure an automated maintenance workflow using a standard PostgreSQL feature called pgAgent or a native Linux cron job.
## 1. Create the Database Pruning Function
First, you need to execute a specialized SQL script inside your Supabase SQL Editor. This script creates a function that deletes old records and then reclaims the physical disk storage space using the VACUUM command. [1] 

CREATE OR REPLACE FUNCTION prune_old_whatsapp_data()RETURNS void AS $$BEGIN
    -- 1. Delete webhook log history older than 30 days
    DELETE FROM wacrm.webhook_logs 
    WHERE created_at < NOW() - INTERVAL '30 days';

    -- 2. Delete raw message delivery tracing metadata older than 60 days
    DELETE FROM wacrm.message_receipts 
    WHERE updated_at < NOW() - INTERVAL '60 days';

    -- 3. Optional: Delete older contact activity/audit tracking streams
    DELETE FROM wacrm.activity_logs 
    WHERE executed_at < NOW() - INTERVAL '90 days';

    -- 4. Reclaim physical disk storage space immediately
    -- Note: VACUUM FULL locks tables; simple VACUUM reuses space without downtime.
    VACUUM;END;
$$ LANGUAGE plpgsql;

(Note: Replace wacrm.webhook_logs and other table paths with the exact schema and table names present in your cloned repository's migration files).
## 2. Automate Execution with a Server Cron Job [2] 
Instead of using complex cloud scheduling extensions, configure your Hetzner Host OS to trigger this cleanup function automatically every single night at 2:00 AM when user traffic is at its absolute lowest.

   1. SSH into your Hetzner CX33 server terminal.
   2. Open the system cron configurations configuration editor:
   
   crontab -e
   
   3. Add the following execution command at the very bottom of the file (ensure you swap out the placeholder parameters with your real self-hosted PostgreSQL connection credentials):
   
   0 2 * * * docker exec -i supabase_db_container_name psql -U postgres -d postgres -c "SELECT prune_old_whatsapp_data();" >> /var/log/supabase_prune.log 2>&1
   
   [3] 

## 🧠 Performance & Maintenance Safety Guidelines

* Avoid VACUUM FULL During Business Hours: Running a simple VACUUM cleans row links and frees up space for subsequent database inserts while keeping tables fully open. Running a VACUUM FULL reclaims raw megabytes back to the host Linux OS, but it completely locks your database tables, causing incoming WhatsApp messages to fail until it completes. [4, 5, 6] 
* Archive Before Deleting (Optional): If your clients demand access to year-old analytics data, use your pruning script to export the target rows out as a cheap .csv string or JSON payload to your external Cloudflare R2 bucket right before firing the destructive DELETE sequence.

By combining media offloading (Point 1), strict container RAM limits (Point 2), and automated daily database pruning (Point 4), your single $10.59/month Hetzner instance can easily double its active runtime lifespan.
Would you like to look over a Node.js script that handles the cloud archiving loop before deletion, or do you need help identifying the exact WhatsApp log table names inside the ArnasDon/wacrm schema files?

[1] [https://medium.com](https://medium.com/@_lukasz_/postgresql-table-maintenance-a-comprehensive-guide-to-vacuum-vacuum-full-and-pg-repack-d85a926b6510)
[2] [https://www.unitech.qa](https://www.unitech.qa/announcements/155/Automating-Residual-Files-Cleanup-in-cPanel-Websites.html)
[3] [https://betterstack.com](https://betterstack.com/community/guides/logging/how-to-manage-log-files-with-logrotate-on-ubuntu-20-04/)
[4] [https://www.singlestore.com](https://www.singlestore.com/blog/understanding-postgresql-data-fragmentation-and-how-singlestoredb-is-better/)
[5] [https://docs.apigee.com](https://docs.apigee.com/private-cloud/v4.51.00/recurring-analytics-services-maintenance-tasks)
[6] [https://demirhuseyinn-94.medium.com](https://demirhuseyinn-94.medium.com/optimizing-postgresql-tables-exploring-vacuuming-strategies-to-combat-bloat-5347bde56f10)


