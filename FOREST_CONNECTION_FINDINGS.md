# Forest Connection Investigation Report

**Date:** 2025-10-19
**Issue:** Camper timing out when connecting to Forest server
**Status:** Partially resolved - Forest server fixed, Camper client issue identified

---

## Summary

The connection timeout issue had **two root causes**:

1. **Forest server `/api/v1/stats` endpoint was hanging** (FIXED ✅)
2. **Camper client has an issue with the stats response processing** (NEEDS INVESTIGATION 🔍)

---

## What We Fixed

### 1. Forest Server - Stats Endpoint Blocking

**Problem:** The `/api/v1/stats` endpoint was hanging indefinitely due to `buildGraph()` blocking the event loop.

**Root Cause:**
- `src/core/stats.ts` was calling `buildGraph()` which loads all edges/nodes into a graph structure
- With a large database (524 nodes in this case), this operation blocks the event loop
- sql.js (SQLite WASM) can block when processing large datasets

**Solution:** Removed the `buildGraph()` call and computed degree statistics directly from edge records:

```typescript
// Before: Used graph.degree() which required building entire graph
const graph = await buildGraph();
const degrees = nodes.map((node) => graph.degree(node.id));

// After: Compute degrees directly from edges (much faster)
const nodeDegrees = new Map<string, number>();
for (const edge of edges) {
  nodeDegrees.set(edge.sourceId, (nodeDegrees.get(edge.sourceId) ?? 0) + 1);
  nodeDegrees.set(edge.targetId, (nodeDegrees.get(edge.targetId) ?? 0) + 1);
}
const degrees = nodes.map((node) => nodeDegrees.get(node.id) ?? 0);
```

**Files Changed:**
- `src/core/stats.ts` - Removed `buildGraph()` import and usage, computed degrees from edges

**Verification:**
```bash
# This now works instantly
curl http://localhost:3000/api/v1/stats
# Returns 200 OK in ~50ms with 2448 bytes
```

### 2. Camper Development Environment

**Changed:** Updated `package.json` to use `bun` instead of `tsx`:

```json
"scripts": {
  "dev": "bun run src/index.tsx"  // was: "tsx src/index.tsx"
}
```

**Rationale:** Forest server uses Bun, and Bun's fetch implementation has better performance characteristics.

---

## Remaining Issue - Camper Client

### The Problem

Even with the Forest server fixed, **the Camper client still times out on the stats endpoint**:

```
✓ /api/v1/health works (14ms)
✗ /api/v1/stats times out (5000ms+)
```

However, **direct requests work perfectly**:

```bash
# Works instantly
curl http://localhost:3000/api/v1/stats

# Works instantly
bun -e "const r = await fetch('http://localhost:3000/api/v1/stats'); console.log(r.status)"
# Output: 200
```

### What This Means

The issue is **inside the Camper ForestClient** class, specifically in how it processes the stats response. The fetch completes successfully, but something in the response processing chain is blocking or hanging.

### Likely Culprits

Based on code review, the issue is probably in one of these methods:

1. **`normalizeStats()` (line 313-334)** - Complex response normalization logic
   - Extracting nested sections
   - Type coercion
   - Multiple fallback paths

2. **`unwrap()` (line 640-653)** - Envelope unwrapping
   - Checks for envelope pattern
   - Error handling

3. **`extractSection()` (line 336-350)** - Helper function
   - Object traversal
   - Could have edge cases with unexpected response shape

### Debug Tools Added

Added `DEBUG_FOREST_CLIENT` environment variable support to `forestClient.ts`:

```bash
DEBUG_FOREST_CLIENT=1 bun run test-connection.ts
```

This will log request/response details to help diagnose where the hang occurs.

---

## Testing

### Diagnostic Script

Created `packages/camper/test-connection.ts` to test the exact code path Camper uses:

```bash
# Run from forest root
bun run packages/camper/test-connection.ts

# Or from camper directory
cd packages/camper
bun run test-connection.ts
```

**Current Output:**
```
✓ Health endpoint: Success in 14ms
✗ Stats endpoint: Timed out after 5000ms
```

### Manual Verification

All these work correctly:

```bash
# Forest server is running and healthy
curl http://localhost:3000/api/v1/health
# {"success":true,"data":{"status":"healthy",...}}

# Stats endpoint works via curl
curl http://localhost:3000/api/v1/stats
# {"success":true,"data":{"nodes":{"total":524,...}}}

# Stats endpoint works via Bun fetch
bun -e "const r = await fetch('http://localhost:3000/api/v1/stats'); console.log(r.status)"
# 200
```

---

## Recommended Next Steps for Camper Team

1. **Enable debug logging** and run the test:
   ```bash
   DEBUG_FOREST_CLIENT=1 bun run packages/camper/test-connection.ts
   ```

2. **Add logging to `normalizeStats()`** to see if it's receiving the response:
   ```typescript
   private normalizeStats(source: unknown): ForestStatsResponse {
     console.log('[normalizeStats] Input:', JSON.stringify(source).slice(0, 200));
     // ... rest of function
   ```

3. **Check for infinite loops** in:
   - `normalizeStats()`
   - `extractSection()`
   - `coerceNumber()`
   - `coerceString()`

4. **Test with simpler response** - Temporarily modify Forest's `/api/v1/stats` to return a minimal response and see if that works

5. **Consider timeout in normalize functions** - The 5-second timeout is triggering, which suggests synchronous blocking code

---

## Files Modified

### Forest (Fixed)
- `src/core/stats.ts` - Removed blocking `buildGraph()` call

### Camper (Debug Tools Added)
- `package.json` - Changed dev script to use `bun` instead of `tsx`
- `src/client/forestClient.ts` - Added `DEBUG_FOREST_CLIENT` logging
- `test-connection.ts` - Created diagnostic script (NEW)

---

## Environment Details

- **Forest Server:** Running on `http://localhost:3000` (dual-stack IPv4/IPv6)
- **Database:** `/Users/bwl/Developer/forest/forest.db` (524 nodes)
- **Runtime:** Bun
- **Platform:** macOS (Darwin 25.1.0)

---

## Contact

If you need more details or want me to investigate specific parts of the client code, let me know!
