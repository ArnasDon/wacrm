#!/usr/bin/env python3
"""
Replace the ASCII apostrophe with a typographic one inside SQL line
comments, on stdin -> stdout.

Why this exists: Postgres parses `-- the ad's URL` perfectly well, but
the Supabase SQL Editor splits a pasted script into statements on the
client side, and its splitter tracks quotes without first stripping
comments. That lone apostrophe reads as the start of a string literal, so
quote parity inverts and the script gets cut in the wrong place — which
surfaces as a baffling `syntax error at or near "'organic'"` pointing at
a line that is fine.

Rather than strip the apostrophes out of the migrations themselves (the
comments there explain *why* the schema looks the way it does, and are
worth more than this workaround), the generated deploy bundle gets them
swapped for U+2019. Same reading, no quote hazard.

The scan is a small lexer, not a regex, because `--` is only a comment
outside of string literals: `'a--b'` and dollar-quoted function bodies
must be left alone. Comments *inside* a dollar-quoted body are still
rewritten — to Postgres they are part of a string literal so nothing
changes semantically, but a naive splitter that does not understand
dollar quoting is exactly what we are defending against.
"""

import re
import sys

APOSTROPHE = "’"

# $$ or $tag$ — Postgres dollar quoting.
DOLLAR_TAG = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$")


def sanitize(sql: str) -> str:
    out = []
    i = 0
    n = len(sql)
    # None, or the dollar-quote tag currently open (e.g. '$$' or '$fn$').
    dollar_tag = None

    while i < n:
        ch = sql[i]

        if dollar_tag:
            if sql.startswith(dollar_tag, i):
                out.append(dollar_tag)
                i += len(dollar_tag)
                dollar_tag = None
                continue
            # Inside a dollar-quoted body: rewrite line comments there too.
            if sql.startswith("--", i):
                end = sql.find("\n", i)
                if end == -1:
                    end = n
                out.append(sql[i:end].replace("'", APOSTROPHE))
                i = end
                continue
            out.append(ch)
            i += 1
            continue

        # Opening a dollar-quoted string: $$ or $tag$
        if ch == "$":
            m = DOLLAR_TAG.match(sql, i)
            if m:
                dollar_tag = m.group(0)
                out.append(dollar_tag)
                i = m.end()
                continue

        # A real line comment: rewrite apostrophes to the end of the line.
        if sql.startswith("--", i):
            end = sql.find("\n", i)
            if end == -1:
                end = n
            out.append(sql[i:end].replace("'", APOSTROPHE))
            i = end
            continue

        # A block comment: pass through untouched (they nest in Postgres,
        # but none of the migrations use them).
        if sql.startswith("/*", i):
            end = sql.find("*/", i + 2)
            end = n if end == -1 else end + 2
            out.append(sql[i:end])
            i = end
            continue

        # A single-quoted literal: copy verbatim, honouring '' escaping.
        if ch == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            out.append(sql[i:j])
            i = j
            continue

        out.append(ch)
        i += 1

    return "".join(out)


if __name__ == "__main__":
    sys.stdout.write(sanitize(sys.stdin.read()))
