# TechTonic API (Backend)

Bun + Hono API server for NFT metadata updates. Deployed to Railway.

## Key Rules
- **Runtime:** Bun. **Package manager:** bun. **Framework:** Hono.
- **No imports from parent directory** (`../src/`, `../config/`). Must be independently deployable.
- **No browser APIs** — no DOM, no `window`, no `import.meta.env`. Use `process.env`.
- Entry point: `src/index.ts`. Start: `bun run src/index.ts`.

## Environment Variables
All loaded and validated in `src/config.ts` — throws at startup if missing.

`DEMO_MODE` (`"true"` | `"false"`) switches between devnet and mainnet, mirroring the frontend pattern:
- `DEMO_MODE=true` → devnet RPC, demo collection address, demo deployer keypair
- `DEMO_MODE=false` → mainnet RPC, Season One collection address, Season One deployer keypair

| Variable | Description |
|---|---|
| `DEMO_MODE` | `"true"` for devnet, `"false"` for mainnet |
| `DEPLOYER_KEYPAIR` | Demo/devnet deployer secret key (JSON byte array) |
| `SEASON_ONE_DEPLOYER_KEYPAIR` | Mainnet deployer secret key (JSON byte array) |
| `RPC_ENDPOINT` | Helius devnet RPC URL |
| `SEASON_ONE_RPC_ENDPOINT` | Helius mainnet RPC URL |
| `COLLECTION_ADDRESS` | Demo/devnet MPL Core collection public key |
| `SEASON_ONE_COLLECTION_ADDRESS` | Mainnet MPL Core collection public key |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |

## Project Structure
```
server/src/
├── index.ts               # Hono app, CORS, health check, route mounting
├── config.ts              # Env var loading + validation
├── lib/umi.ts             # UMI singleton (deployer keypair + Irys uploader)
├── routes/update-nft.ts   # POST /api/update-nft handler
├── services/
│   ├── irys-upload.ts     # Irys file upload with retry
│   ├── metadata.ts        # Fetch existing + build updated metadata JSON
│   └── on-chain-update.ts # MPL Core update() transaction
└── middleware/
    ├── verify-signature.ts # ed25519 signature verification
    └── rate-limit.ts       # In-memory per-asset cooldown
```

## Conventions
- All error responses: `{ error: string }` JSON with appropriate HTTP status.
- Use `update()` from mpl-core (not deprecated `updateV1`).
- Irys uploads: one retry on empty URI, then throw.
