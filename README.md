# Camper

Ink-powered companion interface for the Forest knowledge base.

## Getting Started
- Ensure `forest serve` is running and reachable (default API base: `http://localhost:3000/api/v1`).
- From this directory, install dependencies (`npm install`) and run `npm run dev` for a live Ink session.
- Use `npm run build` to produce the distributable CLI in `dist/`, then invoke it via `node dist/index.js` or with the `camper` binary.
- Configure the server endpoint by exporting `CAMPER_FOREST_URL` (default `http://localhost:3000`) and optional `CAMPER_FOREST_API_PREFIX` (default `/api/v1`); adjust timeouts with `CAMPER_REQUEST_TIMEOUT_MS` (milliseconds).
- Override Camper's config directory (used for tag favourites) with `CAMPER_CONFIG_DIR` if you prefer a location other than `~/.camper`.

## Available Scripts
- `npm run dev` — Start Camper in watch mode with `tsx`, ideal during development.
- `npm run build` — Bundle the CLI with `tsup`, emitting both CJS/ESM outputs and type declarations.
- `npm run typecheck` — Run the TypeScript compiler in no-emit mode.
- `npm start` — Execute the built CLI from `dist/index.js`.

## Next Steps
- Allow naming and pinning saved tag favorites for quick recall.
- Expose accept/reject flows for suggestions within the note relationships view.
- Wire up configuration for server discovery and CLI fallback.
