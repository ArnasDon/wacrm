# Instagram DM Integration — Implementation Plan

## Files to Create/Modify
- [ ] ~~`supabase/migrations/040_instagram_config.sql` — New table for IG credentials~~ ✅ Done
- [ ] ~~`src/lib/instagram/client.ts` — Graph API client for Instagram (send DMs, verify)~~ ✅ Done
- [ ] ~~`src/lib/instagram/index.ts` — Exports~~ ✅ Done
- [ ] ~~`src/app/api/instagram/webhook/route.ts` — GET (verify) + POST (receive DMs, respond with wa.me link)~~ ✅ Done
- [ ] ~~`src/app/api/instagram/config/route.ts` — GET/POST/DELETE for IG config management~~ ✅ Done
- [ ] ~~`src/components/settings/instagram-config.tsx` — Instagram settings form~~ ✅ Done
- [ ] ~~`src/app/(dashboard)/settings/page.tsx` — Add Instagram tab~~ ✅ Done
- [x] `messages/en.json` — Add Instagram settings translations ✅ Done
- [x] `src/components/settings/instagram-config.tsx` — Update to use i18n `t()` calls ✅ Done

