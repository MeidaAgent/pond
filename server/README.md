# Pond Backend

A production-grade Node.js + TypeScript backend for the [usepond.xyz](https://usepond.xyz)
frontend. The frontend is a static dApp that talks directly to Robinhood Chain
through the user's wallet, but it also calls a small set of supplementary
services: a deposit keeper, an address-unlock checker, a market calendar, and
read-only helpers for positions, rebates, and outcome series.

This service exposes all of those over REST.

## Features

- **Node.js 18+** with strict TypeScript
- **Express 4** with CORS, JSON parsing, URL-encoded parsing, and rate limiting
- **Zod** request validation for every POST endpoint
- **Global error handler** that turns thrown errors into clean JSON responses
- **JSON-RPC client** that prefers the configured Robinhood Chain RPC and falls
  back to a deterministic in-process mock engine for development
- Modular structure: `routes/`, `services/`, `middleware/`, `schemas/`, `config/`

## Folder layout

```
server/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
└── src/
    ├── index.ts                  # Express bootstrap
    ├── config/
    │   └── protocol.ts           # Token, contract, and chain constants
    ├── middleware/
    │   ├── asyncHandler.ts       # Async route wrapper
    │   └── errorHandler.ts       # Global error handler + HttpError
    ├── routes/
    │   └── api.ts                # All REST endpoints
    ├── schemas/
    │   └── validation.ts         # Zod request schemas
    ├── services/
    │   ├── acreService.ts        # Business logic
    │   └── rpc.ts                # JSON-RPC client + mock engine
    ├── types/
    │   └── domain.ts             # Domain types
    └── utils/
        └── eth.ts                # Address + decimal helpers
```

## Endpoints

| Method | Path                                | Purpose |
| ------ | ----------------------------------- | ------- |
| GET    | `/api/health`                       | Liveness probe |
| GET    | `/api/network`                      | Chain metadata |
| GET    | `/api/config`                       | Full protocol config |
| POST   | `/api/watch`                        | Register an address with the keeper |
| GET    | `/api/watch`                        | List current watch registrations |
| GET    | `/api/check/:address`               | Borrow capacity + collateral lookup |
| POST   | `/api/check`                        | Same, with body |
| GET    | `/api/pool/stats`                   | Global pool statistics |
| GET    | `/api/market/calendar`              | Current market session |
| GET    | `/api/market/prices`                | Oracle prices for the collateral set |
| GET    | `/api/positions/:address`           | Full per-account view |
| GET    | `/api/positions/:address/legacy`    | Legacy-deployment positions |
| GET    | `/api/deposits/addresses`           | The three transfer addresses |
| GET    | `/api/deposits/:address`            | Pending transfers for an account |
| GET    | `/api/rebate/:address`              | Rebate tier + accrued rewards |
| GET    | `/api/rebate/solvency`              | Protocol solvency for rebate payouts |
| GET    | `/api/outcome/series`               | List defined outcome series |
| GET    | `/api/outcome/series/:id`           | Single series by id |
| POST   | `/api/deleverage/preview`           | Dry run of a deleverage plan |
| POST   | `/api/analytics/track`              | Best-effort analytics hook |
| POST   | `/api/utils/validate-address`       | One-shot address validator |

## Running

```bash
# 1. Install dependencies
npm install

# 2. Copy the example env and edit it
cp .env.example .env

# 3. Start the dev server (auto-reloads on file change)
npm run dev

# 4. Type-check / build
npm run typecheck
npm run build
npm start
```

The server listens on `http://localhost:${PORT:-4000}`.

## Configuration

All runtime config is read from environment variables. See
[`.env.example`](./.env.example) for the full list.

| Variable               | Default                            | Notes |
| ---------------------- | ---------------------------------- | ----- |
| `PORT`                 | `4000`                             | HTTP port |
| `HOST`                 | `0.0.0.0`                          | Bind address |
| `NODE_ENV`             | `development`                      | Standard Node env |
| `CORS_ORIGIN`          | `*`                                | Comma-separated origins, or `*` |
| `RATE_LIMIT_WINDOW_MS` | `60000`                            | Rate limit window |
| `RATE_LIMIT_MAX`       | `120`                              | Max requests per window per IP |
| `RPC_URL`              | (Robinhood Chain public RPC)       | Empty = mock engine |
| `CHAIN_ID`             | `4663`                             | Robinhood Chain id |
| `ALLOW_MOCK`           | `true`                             | If true, the mock engine answers when RPC is empty/unreachable |
| `KEEPER_WATCH_URL`     | `https://usepond.xyz/watch`        | Mirrors the frontend config |

## Error responses

All non-2xx responses share the same envelope:

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_CODE",
  "details": { "...": "optional, validation errors etc." }
}
```

`code` values include `BAD_REQUEST`, `VALIDATION_ERROR`, `NOT_FOUND`,
`TOO_MANY_REQUESTS`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`,
`ROUTE_NOT_FOUND`.

## Notes

- The backend is **read-only**: wallet-signed actions (supply, borrow,
  withdraw, repay, etc.) remain on the frontend and are sent directly to
  Robinhood Chain.
- The `watch` endpoint is the only stateful one — it stores registrations in
  process memory. Production deployments should swap that for a real database.
- The mock engine is deterministic per address so it is suitable for tests and
  local development without a network connection.
