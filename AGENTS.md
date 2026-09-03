<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# waCRM — Agent Guide

waCRM is a self-hostable CRM for WhatsApp built on Next.js 16 + Supabase.

## Build / Lint / Test Commands

```bash
npm run dev          # Turbopack dev server (port 3000)
npm run build        # Production build (also runs typecheck)
npm run lint         # ESLint v9 (flat config)
npm run typecheck    # tsc --noEmit (strict)
npm run format       # Prettier (writes)
npm run format:check # Prettier (check only, for CI)
npm run test         # vitest run (all tests)
npm run test:watch   # vitest (watch mode)
```

### Running a single test

```bash
npx vitest run src/lib/whatsapp/encryption.test.ts
npx vitest run --reporter=verbose src/lib/api-keys
```

Vitest config is in `vitest.config.ts`:
- `node` environment, `clearMocks: true`
- Test env vars: `ENCRYPTION_KEY` (64 hex chars), `META_APP_SECRET`
- Test patterns: `src/**/*.test.ts` and `src/**/*.test.tsx`
- Uses `@/*` → `./src/*` path alias resolution

### CI pipeline (`.github/workflows/ci.yml`)

Runs in order on PRs to `main` and pushes to `main`:
1. `npm ci` → 2. `npm run lint` → 3. `npm run typecheck` → 4. `npm test` → 5. `npm run build`

## Code Style Guidelines

### Imports

Order: (1) Node built-ins (`node:crypto`), (2) third-party npm packages, (3) `@/` aliases, (4) relative imports for co-located siblings.

```typescript
import { createHash, randomBytes } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { clsx, type ClassValue } from "clsx";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { decrypt, encrypt } from "./encryption";
```

### Formatting

Configured via `.prettierrc`:
- `semi: true`, `singleQuote: true`, `trailingComma: "es5"`
- `printWidth: 80`, `tabWidth: 2`, `arrowParens: "always"`
- `endOfLine: "lf"`
- Tailwind class sorting via `prettier-plugin-tailwindcss`
- JSX uses double quotes (Prettier default)

### Types

- `strict: true` in `tsconfig.json`
- Target: ES2017, JSX: `react-jsx`, Module: `esnext` with `bundler` resolution
- Export types/interfaces with `type` keyword when importing: `import type { User } from "..."`
- Use `readonly` on constant arrays: `readonly AccountRole[]`
- Use `as const` on literal tuple definitions
- Prefer interfaces for public API types, inline `type` aliases for internal unions

### Naming Conventions

| Category | Convention | Examples |
|---|---|---|
| Files & dirs | `kebab-case` | `phone-utils.ts`, `template-send-builder.ts` |
| React components | `PascalCase` | `Button`, `DashboardShell`, `ThemedToaster` |
| Functions / methods | `camelCase` | `generateApiKey()`, `formatCurrency()` |
| Types / interfaces | `PascalCase` | `AccountRole`, `ApiScope`, `CurrencyOption` |
| Constants | `UPPER_SNAKE` | `API_KEY_PREFIX`, `RATE_LIMITS`, `DEFAULT_CURRENCY` |
| React hooks | `use*` prefix | `useAuth`, `useCan`, `useTheme` |
| Test helpers | `__reset*ForTests` | `__resetRateLimitForTests()` |
| API routes | kebab-case dirs + `route.ts` | `app/api/whatsapp/send/route.ts` |

### Error Handling

- Custom error classes with numeric `status` property for API routes (see `src/lib/auth/account.ts`)
- `toErrorResponse(err)` function converts known errors to JSON, unknown to 500
- Try/catch in API route handlers, delegating to error class dispatch
- Graceful fallbacks for non-critical failures (encryption legacy format, currency formatting)
- Fire-and-forget side effects use `.then()` pattern with `void` prefix, not `await`:

```typescript
void supabaseAdmin()
  .from('api_keys')
  .update({ last_used_at: new Date().toISOString() })
  .eq('id', id)
  .then(({ error }) => {
    if (error) console.warn('[api-keys/store] last_used_at bump failed:', error.message);
  });
```

- Empty catch blocks are allowed with an explanatory comment for expected failures (e.g., Supabase SSR cookie set in Server Components)

### React Component Patterns

- `"use client"` directive for interactive components
- `cn()` from `@/lib/utils` (clsx + tailwind-merge) for class merging
- shadcn/ui `base-nova` style components using `data-slot` attributes
- Use `@base-ui/react` primitives (not Radix) for headless UI
- lucide-react for icons
- Theme via React Context (`use-theme.tsx`) — 5 accent themes + light/dark
- Typed as `React.ComponentProps<"div">` for polymorphic wrappers (not `HTMLAttributes`)

## Architecture Notes

- **Supabase client**: Singleton browser client in `src/lib/supabase/client.ts` (avoids auth-lock contention), SSR client in `src/lib/supabase/server.ts`
- **Tests co-located**: every `.ts` source can have a sibling `.test.ts`
- **Pure logic separated from I/O**: modules in `src/lib/auth/`, `src/lib/api-keys/`, `src/lib/whatsapp/` export pure functions with no side effects for easy testing
- **Rate limiting**: in-memory Map-based (swap for Redis by replacing the store)
- **API key auth**: SHA-256 hashing (justified in comments — full-entropy keys don't need slow KDFs)
- **Encryption**: AES-256-GCM with legacy AES-256-CBC backward compatibility
- **Flow engine**: DAG-based execution engine (`src/lib/flows/engine.ts`) with validation, auto-layout, edge computation, and fallback resolution
