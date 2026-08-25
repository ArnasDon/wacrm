# Syncing this fork with upstream

How to pull the latest `ArnasDon/wacrm` changes into this fork **without losing
our translation work** (Kazakh / Russian i18n) or our other customizations.

> **Direction of travel:** this is *inbound only*. We pull upstream **into** our
> fork. We **never** open a pull request back to `ArnasDon/wacrm` — the fork's
> divergence (locale routing, branding, Railway, translations) is the point, and
> the upstream maintainer has explicitly rejected fork-sync PRs. If you find a
> genuine template bug, open it as its own small PR against upstream `main`,
> cherry-picked — never the whole branch.

---

## Repo layout (important)

This project is **nested**:

- **Outer repo** `D:\My work\waCRM` — a thin wrapper on branch `master`. It
  tracks `wacrm` as a broken submodule pointer (mode `160000`, no `.gitmodules`)
  and has some stray junk files. **Not involved in syncing.** See
  [Outer wrapper repo](#outer-wrapper-repo-decide-later).
- **Inner repo** `wacrm/` — the **real fork**. All app code, translations, and
  the sync happen here. Remotes:
  - `origin`   → https://github.com/Kairat619/wacrm
  - `upstream` → https://github.com/ArnasDon/wacrm
  - Canonical working branch: **`sync-upstream-b1`**

Our translation work lives in `src/messages/{en,kk,ru}.json` plus the
locale-routing / i18n commits (`src/app/[locale]/...`, `src/i18n/...`).

### Decisions baked into this workflow
- **Canonical branch:** stay on `sync-upstream-b1`.
- **Integration method:** **merge**, never rebase. Rebase would rewrite our
  already-pushed commits (including merge commits) and multiply conflict
  resolution across every commit.

---

## TL;DR — the recipe

```bash
# ALWAYS run inside the inner repo:
cd "D:/My work/waCRM/wacrm"

git status                                     # must be clean first
git branch backup/pre-sync-YYYYMMDD-<sha>      # safety net
git fetch upstream --prune
git checkout sync-upstream-b1                  # our branch, NOT main
git pull origin sync-upstream-b1               # in case another machine pushed
git merge upstream/main                        # MERGE (never rebase)
# ...resolve conflicts, protecting translations (see Step 4)...
git commit                                     # keep default merge message
npm install && npm run typecheck && npm test && npm run lint && npm run build
git push origin sync-upstream-b1               # push to OUR fork only
```

---

## Step-by-step

> All commands run **inside `wacrm/`**. Either `cd "D:\My work\waCRM\wacrm"`
> first, or prefix each command with `git -C "D:\My work\waCRM\wacrm"`.

### Step 0 — Safety pre-checks
1. Confirm a clean tree: `git status` → "nothing to commit, working tree clean".
   If not, commit or stash first.
2. Create a rollback branch (Windows shells don't expand `$(date)`; use today's
   date + current short SHA):
   ```bash
   git rev-parse --short HEAD                       # note the sha
   git branch backup/pre-sync-YYYYMMDD-<sha> sync-upstream-b1
   ```

### Step 1 — Fetch the latest upstream
```bash
git fetch upstream --prune
git log --oneline --graph sync-upstream-b1..upstream/main   # preview incoming
```
Optional but useful — predict conflicts before merging:
```bash
git merge-tree --write-tree --name-only sync-upstream-b1 upstream/main | head -40
```

### Step 2 — Get on the branch and make it current
```bash
git checkout sync-upstream-b1
git pull origin sync-upstream-b1
```

### Step 3 — Merge upstream
```bash
git merge upstream/main
```
Clean merge → skip to Step 5. Tip: `git merge upstream/main --no-ff --no-commit`
pauses before committing so you can resolve deliberately.

### Step 4 — Resolve conflicts (protecting translations)

List conflicts: `git status`. Then, per file type:

- **`src/messages/en.json`** — keep **our structure** (lowercase namespaces such
  as `dashboard`, `broadcasts`, `automations`; upstream uses PascalCase like
  `Dashboard.page`). **Add only the genuinely new keys** upstream introduced that
  our merged code now references. Don't blindly accept either side.
- **`src/messages/kk.json` / `ru.json`** — union: keep our translated strings,
  add the same new keys (translated). Keep keys in parity with `en.json`.
- **`messages/*.json` (top-level, if it reappears)** — keep **deleted**. Our
  catalogues live under `src/messages/`, not the repo root.
- **Code conflicts** (e.g. `src/app/[locale]/(dashboard)/...`,
  `src/components/...`) — generally take **upstream's logic**, then re-apply our
  customizations:
  - locale-aware routing (`[locale]`, `@/i18n/navigation`)
  - our i18n namespace/variable names (e.g. `tDetail` on `broadcasts.detail`,
    `automations.builder`) — remap upstream's `t('...')` calls accordingly
  - branding, KZT currency, Railway config
- **`.dockerignore` / config add-adds** — union both sides, deduplicated.

After each file: `git add <file>`. Then:
```bash
git grep -n "^<<<<<<< " ; git grep -n "^>>>>>>> "   # must return nothing
git commit                                          # keep default merge message
```

**Migrations rule:** never edit an already-applied migration (e.g.
`035_*.sql`). Upstream treats them as immutable. If upstream adds new numbered
migrations, keep them as new files; if you need a schema change, add a *new*
migration instead of editing an old one.

#### New i18n keys: helper pattern
When upstream adds keys our code references, add them to all three locales at
once with a throwaway Node script (keeps JSON valid + 2-space style, appends
only missing keys). Example skeleton:

```js
// scripts/_merge-add-keys.mjs  (delete after running)
import { readFileSync, writeFileSync } from 'node:fs';
const additions = {
  'src/messages/en.json': { 'broadcasts.detail': { /* key: "English" */ } },
  'src/messages/kk.json': { 'broadcasts.detail': { /* key: "Қазақша" */ } },
  'src/messages/ru.json': { 'broadcasts.detail': { /* key: "Русский" */ } },
};
for (const [file, groups] of Object.entries(additions)) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  for (const [ns, keys] of Object.entries(groups)) {
    const target = ns.split('.').reduce((o, k) => (o[k] ??= {}), json);
    for (const [k, v] of Object.entries(keys)) if (!(k in target)) target[k] = v;
  }
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}
```
```bash
node scripts/_merge-add-keys.mjs && rm scripts/_merge-add-keys.mjs
git add src/messages/en.json src/messages/kk.json src/messages/ru.json
```

### Step 5 — Verify before pushing
```bash
npm install         # upstream may have changed dependencies
npm run typecheck   # fastest signal that conflict resolutions are type-correct
npm test            # Vitest suite (all should pass)
npm run lint        # 0 errors expected (pre-existing warnings are fine)
npm run build       # production build + Next typecheck
```
Also spot-check the running app: language switch (en/kk/ru), branding, currency.

> **Known fork-path test:** `src/i18n/icu-safety.test.ts` (borrowed from
> upstream) hardcodes `messages/en.json`. Our catalogues are under
> `src/messages/`, so it must read `join(process.cwd(), 'src', 'messages',
> 'en.json')`. If a sync reintroduces the upstream path, re-point it.

### Step 6 — Push to our fork
```bash
git push origin sync-upstream-b1     # NEVER a PR to upstream
```

> **Push gotcha — `workflow` scope.** If upstream adds/changes any file under
> `.github/workflows/`, an HTTPS push with a Personal Access Token fails:
> *"refusing to allow a Personal Access Token to create or update workflow ...
> without `workflow` scope"*. Fix:
> 1. GitHub → Settings → Developer settings → PAT → enable the **`workflow`**
>    scope (classic token: checkbox under `repo`).
> 2. Refresh the cached credential so git sends the new token:
>    ```bash
>    printf "protocol=https\nhost=github.com\n\n" | git credential-manager erase
>    cmdkey /delete:git:https://github.com    # Windows credential store
>    ```
> 3. Retry `git push origin sync-upstream-b1` (re-authenticate when prompted).
>
> Alternatives: switch `origin` to SSH (`git@github.com:Kairat619/wacrm.git`),
> or push without the workflow file and add it later.

---

## Rollback (if a sync goes wrong)
```bash
git merge --abort                                  # abort mid-merge
git reset --hard backup/pre-sync-YYYYMMDD-<sha>    # full reset to the backup
```
Once a sync is verified and deployed, delete the backup:
```bash
git branch -D backup/pre-sync-YYYYMMDD-<sha>
```

---

## Outer wrapper repo (decide later)

The outer `D:\My work\waCRM` repo is a separate, mostly-empty wrapper that points
at a specific `wacrm` commit via a **broken submodule** (no `.gitmodules`) and
carries stray junk files. It is **not needed** for syncing. When you want to
clean it up, options are:
- **(a)** properly initialize `.gitmodules` so it's a real submodule,
- **(b)** flatten — delete the inner `.git` and track everything in one repo, or
- **(c)** delete the outer repo and treat `wacrm/` as the only project.

---

## Quick reference — what stays "ours" on every sync
- Lowercase i18n namespaces + kk/ru translations in `src/messages/`
- `[locale]` routing and `@/i18n/*` navigation
- Branding, KZT currency, Railway deploy config, `AGENTS.md`
- New schema changes go in **new** migration files, never edits to applied ones
