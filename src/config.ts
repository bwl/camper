import os from 'node:os';
import path from 'node:path';

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.camper');
const TAG_FAVORITES_FILENAME = 'tag-favorites.json';
const DEFAULT_API_PREFIX = '/api/v1';

export function getForestBaseUrl(): string {
  return process.env.CAMPER_FOREST_URL || DEFAULT_BASE_URL;
}

export function getRequestTimeoutMs(): number {
  const fromEnv = process.env.CAMPER_REQUEST_TIMEOUT_MS;
  if (!fromEnv) {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(fromEnv);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export function getConfigDir(): string {
  return process.env.CAMPER_CONFIG_DIR || DEFAULT_CONFIG_DIR;
}

export function getTagFavoritesFilePath(): string {
  return path.join(getConfigDir(), TAG_FAVORITES_FILENAME);
}

export function getForestApiPrefix(): string {
  return process.env.CAMPER_FOREST_API_PREFIX || DEFAULT_API_PREFIX;
}
