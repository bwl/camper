import { promises as fs } from 'node:fs';
import { getConfigDir, getTagFavoritesFilePath } from '../config.js';

export interface TagFavoriteRecord {
  tags: string[];
  lastUsedAt: string;
  usageCount: number;
}

const DEFAULT_FAVORITES: TagFavoriteRecord[] = [];

export async function loadTagFavorites(): Promise<TagFavoriteRecord[]> {
  const filePath = getTagFavoritesFilePath();
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(contents);
    if (!Array.isArray(parsed)) {
      return DEFAULT_FAVORITES;
    }
    return parsed
      .map((entry) => normalizeFavorite(entry))
      .filter((entry): entry is TagFavoriteRecord => entry !== null);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_FAVORITES;
    }
    console.warn('Failed to read Camper tag favorites:', error);
    return DEFAULT_FAVORITES;
  }
}

export async function saveTagFavorites(favorites: TagFavoriteRecord[]): Promise<void> {
  const filePath = getTagFavoritesFilePath();
  const dir = getConfigDir();
  try {
    await fs.mkdir(dir, { recursive: true });
    const payload = JSON.stringify(favorites, null, 2);
    await fs.writeFile(filePath, payload, 'utf8');
  } catch (error) {
    console.warn('Failed to persist Camper tag favorites:', error);
  }
}

function normalizeFavorite(entry: unknown): TagFavoriteRecord | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const tagsValue = (entry as { tags?: unknown }).tags;
  if (!Array.isArray(tagsValue)) {
    return null;
  }
  const tags = tagsValue
    .map((tag) => (typeof tag === 'string' ? tag : null))
    .filter((tag): tag is string => tag !== null);
  if (tags.length === 0) {
    return null;
  }
  const lastUsedAtRaw = (entry as { lastUsedAt?: unknown }).lastUsedAt;
  const lastUsedAt =
    typeof lastUsedAtRaw === 'string' && !Number.isNaN(Date.parse(lastUsedAtRaw))
      ? lastUsedAtRaw
      : new Date().toISOString();
  const usageCountRaw = (entry as { usageCount?: unknown }).usageCount;
  const usageCount =
    typeof usageCountRaw === 'number' && Number.isFinite(usageCountRaw) && usageCountRaw >= 0
      ? usageCountRaw
      : 1;
  return {
    tags,
    lastUsedAt,
    usageCount,
  };
}
