# Contributing

This repository is ProMarketer's WhatsApp + email marketing platform.
It began as a fork of the open-source
[wacrm](https://github.com/ArnasDon/wacrm) template and has since
diverged into a product; contributions here are to *this* platform.

## Run it locally

```bash
git clone https://github.com/onlypromarketer/wacrm.git
cd wacrm
npm install
npx supabase start                 # local Postgres, auth, storage, mail catcher
cp .env.local.example .env.local   # fill in what `supabase start` printed
npm run dev
```

For the complete platform (CRM + email engine) see
[`deploy/README.md`](./deploy/README.md).

## Before you open a pull request

- Branch off the latest `main`.
- Run the checks the CI runs:

  | Command | What it does |
  | --- | --- |
  | `npm run typecheck` | `tsc --noEmit` |
  | `npm test` | Vitest (use `TZ=UTC npm test` — one date test assumes UTC) |
  | `npm run lint` | ESLint |
  | `npm run format:check` | Prettier, check only |

- If you add a database change, add a new numbered file under
  `supabase/migrations/`, make it idempotent, and note it in
  `CHANGELOG.md` under **Migration required**.
- If you add user-facing text, add the key to **both**
  `messages/en.json` and `messages/ko.json` — a test enforces parity.
  Avoid `{{` in message strings (another test enforces that).
- One logical change per PR. Fill in the PR template, especially the
  **Test plan**.

## Reporting bugs

Use the
[bug report](https://github.com/onlypromarketer/wacrm/issues/new?template=bug_report.yml)
template. Include the commit SHA, how you run it (Docker stack, VPS,
local dev), and logs.

## Security issues

**Do not file security issues publicly.** Follow the private flow in
[`.github/SECURITY.md`](./.github/SECURITY.md).

## Pulling in upstream fixes

The upstream template still receives bug and security fixes. To bring
them in:

```bash
git remote add upstream https://github.com/ArnasDon/wacrm.git   # once
git fetch upstream
git checkout main
git merge upstream/main
# Expect conflicts in areas this platform has customised (the Email
# section, the automation/flow builders, README and metadata).
```

Review each conflict rather than taking either side wholesale.

## Licensing

This repository is MIT ([`LICENSE`](./LICENSE)). The upstream copyright
notice is retained there, as the licence requires. By contributing you
agree your contribution is MIT as well.
