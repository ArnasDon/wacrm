<!--
Heads up: this is a template, not a collaborative product. Most
changes belong in your fork. See CONTRIBUTING.md for which kinds of
upstream PRs tend to land (security, correctness, docs) vs. which
belong in a fork (new features, stack swaps, opinionated refactors).
If you haven't opened an issue yet for a non-trivial change, consider
doing that first to check alignment.

Keep this short and specific. The commit message is where the "why"
lives; this is where the reviewer gets the "what" and "how to try it".
-->

## Summary

<!-- One or two sentences. What does this PR do? -->

## What changed

<!-- Bullet list of the actual changes. Link file paths when useful. -->

## Test plan

<!--
How did you verify this works? How should the reviewer verify it?
Tick the boxes as you go.
-->

- [ ] `pnpm typecheck` clean.
- [ ] `pnpm lint` — no new errors beyond the pre-existing backlog.
- [ ] `pnpm build` succeeds.
- [ ] Feature / fix manually exercised in the browser (or the reason it can't be).

## Related

<!-- Link the issue this closes, or "Part of #N" for multi-PR work. -->

<!--
Heads up:
- Security issues: do not disclose here; see .github/SECURITY.md.
- New deps: please justify briefly in the commit message or PR body.
- Runtime behaviour changes affecting forkers: update docs/*.
-->
