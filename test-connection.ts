#!/usr/bin/env bun
/**
 * Connection diagnostic script for Camper
 * Tests the exact same code path that Camper uses to connect to Forest
 */

import { ForestClient } from './src/client/forestClient.js';
import { getForestBaseUrl, getForestApiPrefix, getRequestTimeoutMs } from './src/config.js';

console.log('='.repeat(80));
console.log('Camper Connection Diagnostic');
console.log('='.repeat(80));

const baseUrl = getForestBaseUrl();
const apiPrefix = getForestApiPrefix();
const timeoutMs = getRequestTimeoutMs();

console.log('\nConfiguration:');
console.log(`  Base URL: ${baseUrl}`);
console.log(`  API Prefix: ${apiPrefix}`);
console.log(`  Timeout: ${timeoutMs}ms`);
console.log(`  Full endpoint: ${baseUrl}${apiPrefix}`);

console.log('\nCreating ForestClient...');
const client = new ForestClient({
  baseUrl,
  timeoutMs,
  apiPrefix,
});

console.log('\nTesting health endpoint...');
const start = Date.now();

try {
  const health = await client.getHealth();
  const elapsed = Date.now() - start;

  console.log(`✓ Success in ${elapsed}ms`);
  console.log('\nHealth response:');
  console.log(`  Status: ${health.status}`);
  console.log(`  OK: ${health.ok}`);
  console.log(`  Version: ${health.version}`);
  console.log(`  Database: ${health.databasePath}`);
  console.log(`  Uptime: ${health.uptimeSeconds}s`);

  console.log('\nTesting stats endpoint...');
  const stats = await client.getStats();
  console.log(`✓ Stats retrieved`);
  console.log(`  Nodes: ${stats.nodes}`);
  console.log(`  Edges: ${stats.edges}`);
  console.log(`  Tags: ${stats.tags}`);
  console.log(`  Suggested edges: ${stats.suggestedEdges}`);

  console.log('\n' + '='.repeat(80));
  console.log('All tests passed! Camper should be able to connect.');
  console.log('='.repeat(80));
  process.exit(0);
} catch (error) {
  const elapsed = Date.now() - start;
  console.log(`✗ Failed after ${elapsed}ms`);
  console.error('\nError:');
  console.error(error instanceof Error ? error.message : String(error));
  console.error('\nStack trace:');
  console.error(error instanceof Error ? error.stack : '');

  console.log('\n' + '='.repeat(80));
  console.log('Connection test failed!');
  console.log('='.repeat(80));
  console.log('\nTroubleshooting steps:');
  console.log('1. Ensure Forest server is running: bun run dev:server (from forest root)');
  console.log('2. Test manually: curl http://localhost:3000/api/v1/health');
  console.log('3. Check CAMPER_FOREST_URL environment variable');
  console.log('4. Check for firewall/network issues');
  process.exit(1);
}
