import React from 'react';
import { Box, Text, useInput } from 'ink';
import { ForestClient } from '../client/forestClient.js';
import { getForestBaseUrl, getForestApiPrefix, getRequestTimeoutMs } from '../config.js';
import {
  ForestHealthResponse,
  ForestNodeContent,
  ForestNodeListItem,
  ForestNodeListResponse,
  ForestTagListItem,
  ForestNodeDetail,
  ForestEdgeRecord,
  ForestEvent,
  EventStreamStatus,
  ForestStatsResponse,
} from '../client/types.js';
import {
  loadTagFavorites,
  saveTagFavorites,
  TagFavoriteRecord,
} from '../storage/tagFavorites.js';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; health: ForestHealthResponse; stats: ForestStatsResponse }
  | { status: 'error'; error: string };

export function App(): React.ReactElement {
  const client = React.useMemo(
    () =>
      new ForestClient({
        baseUrl: getForestBaseUrl(),
        timeoutMs: getRequestTimeoutMs(),
        apiPrefix: getForestApiPrefix(),
      }),
    [],
  );

  const [state, setState] = React.useState<LoadState>({ status: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [health, stats] = await Promise.all([client.getHealth(), client.getStats()]);
        if (!cancelled) {
          setState({ status: 'ready', health, stats });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client]);

  const baseUrl = getForestBaseUrl();
  const apiPrefix = getForestApiPrefix();
  const displayBaseUrl = apiPrefix
    ? `${baseUrl.replace(/\/+$/, '')}${apiPrefix.startsWith('/') ? apiPrefix : `/${apiPrefix}`}`
    : baseUrl;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
      <Text color="greenBright">Camper</Text>
      <Box flexDirection="column" gap={1}>
        <Text>Cozy companion for the Forest knowledge base.</Text>
        <Box flexDirection="row" flexWrap="wrap">
          <Text>This is the early scaffolding: connect to a Forest server with </Text>
          <Text color="cyan">forest serve</Text>
          <Text> and watch this space.</Text>
        </Box>
        <Box flexDirection="column" gap={1} borderStyle="round" borderColor="green">
          <Text>
            <Text color="cyan">Server:</Text> {displayBaseUrl}
          </Text>
          {state.status === 'loading' && <Text color="yellow">Connecting to Forest…</Text>}
          {state.status === 'error' && (
            <Box flexDirection="column">
              <Text color="red">Unable to reach Forest server.</Text>
              <Text>{state.error}</Text>
              <Text dimColor>
                Ensure `forest serve` is running, then re-launch Camper. Set `CAMPER_FOREST_URL`
                to change the endpoint.
              </Text>
            </Box>
          )}
          {state.status === 'ready' && (
            <Box flexDirection="column" gap={1}>
              <ConnectedSummary health={state.health} stats={state.stats} />
              <NotesPane client={client} />
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function ConnectedSummary({
  health,
  stats,
}: {
  health: ForestHealthResponse;
  stats: ForestStatsResponse;
}): React.ReactElement {
  const statusColor = health.ok ? 'greenBright' : 'yellow';
  const statusText = health.status ?? (health.ok ? 'healthy' : 'degraded');
  const uptimeText = typeof health.uptimeSeconds === 'number'
    ? ` • uptime ${formatDuration(health.uptimeSeconds)}`
    : '';
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text color={statusColor}>
          Health: {statusText}
          {uptimeText}
        </Text>
        {health.version && <Text dimColor>Forest version {health.version}</Text>}
        {health.databasePath && <Text dimColor>DB: {health.databasePath}</Text>}
        {health.message && <Text dimColor>{health.message}</Text>}
      </Box>
      <StatsGrid stats={stats} />
    </Box>
  );
}

function StatsGrid({ stats }: { stats: ForestStatsResponse }): React.ReactElement {
  const entries: Array<{ label: string; value: number | string }> = [];
  if (typeof stats.nodes === 'number') {
    entries.push({ label: 'Nodes', value: stats.nodes });
  }
  if (typeof stats.edges === 'number') {
    entries.push({ label: 'Edges', value: stats.edges });
  }
  if (typeof stats.suggestedEdges === 'number') {
    entries.push({ label: 'Suggestions', value: stats.suggestedEdges });
  }
  if (typeof stats.tags === 'number') {
    entries.push({ label: 'Tags', value: stats.tags });
  }
  if (entries.length === 0) {
    return <Text dimColor>No stats available yet.</Text>;
  }
  return (
    <Box flexDirection="row" gap={3}>
      {entries.map((entry) => (
        <Box key={entry.label} flexDirection="column" minWidth={12}>
          <Text color="cyan">{entry.label}</Text>
          <Text>{entry.value}</Text>
        </Box>
      ))}
    </Box>
  );
}

type NotesState =
  | { status: 'loading' }
  | { status: 'ready'; response: ForestNodeListResponse }
  | { status: 'error'; error: string };

type ContentState =
  | { status: 'idle' }
  | { status: 'loading'; id: string }
  | { status: 'ready'; id: string; content: ForestNodeContent }
  | { status: 'error'; id: string; error: string };

type DetailState =
  | { status: 'idle' }
  | { status: 'loading'; id: string }
  | { status: 'ready'; id: string; detail: ForestNodeDetail }
  | { status: 'error'; id: string; error: string };

type FavoritesState =
  | { status: 'loading'; favorites: TagFavoriteRecord[] }
  | { status: 'ready'; favorites: TagFavoriteRecord[] }
  | { status: 'error'; favorites: TagFavoriteRecord[]; error: string };

type InputMode = 'normal' | 'search' | 'tags' | 'favorites';

const PAGE_SIZE = 20;

function NotesPane({ client }: { client: ForestClient }): React.ReactElement {
  const [notesState, setNotesState] = React.useState<NotesState>({ status: 'loading' });
  const [selectedId, setSelectedId] = React.useState<string | undefined>(undefined);
  const [contentState, setContentState] = React.useState<ContentState>({ status: 'idle' });
  const [forcedRefreshId, setForcedRefreshId] = React.useState<string | undefined>(undefined);
  const [eventStatus, setEventStatus] = React.useState<EventStreamStatus>('connecting');
  const [eventError, setEventError] = React.useState<string | undefined>(undefined);
  const [tagState, setTagState] = React.useState<
    { status: 'loading'; tags: ForestTagListItem[] } |
      { status: 'ready'; tags: ForestTagListItem[] } |
      { status: 'error'; tags: ForestTagListItem[]; error: string }
  >({ status: 'loading', tags: [] });
  const [filters, setFilters] = React.useState<{ search: string; tags: string[] }>({
    search: '',
    tags: [],
  });
  const [page, setPage] = React.useState(0);
  const [inputMode, setInputMode] = React.useState<InputMode>('normal');
  const [draftInput, setDraftInput] = React.useState('');
  const [detailState, setDetailState] = React.useState<DetailState>({ status: 'idle' });
  const [forcedDetailRefreshId, setForcedDetailRefreshId] = React.useState<string | undefined>(
    undefined,
  );
  const [favoritesState, setFavoritesState] = React.useState<FavoritesState>({
    status: 'loading',
    favorites: [],
  });
  const [favoriteIndex, setFavoriteIndex] = React.useState(0);
  const [tagSuggestionIndex, setTagSuggestionIndex] = React.useState(0);
  const loadingRef = React.useRef(false);
  const selectedIdRef = React.useRef<string | undefined>(undefined);
  const filtersRef = React.useRef(filters);
  const pageRef = React.useRef(page);
  const tagLoadingRef = React.useRef(false);
  const favoritesRef = React.useRef<TagFavoriteRecord[]>([]);
  const prevTagsRef = React.useRef<string[]>(filters.tags);

  const persistFavorites = React.useCallback((favorites: TagFavoriteRecord[]) => {
    void saveTagFavorites(favorites);
  }, []);

  const applyFavoriteUpdate = React.useCallback(
    (updater: (current: TagFavoriteRecord[]) => TagFavoriteRecord[] | null) => {
      setFavoritesState((prev) => {
        const current = prev.favorites;
        const updated = updater(current);
        if (!updated) {
          return prev;
        }
        favoritesRef.current = updated;
        persistFavorites(updated);
        return { status: 'ready', favorites: updated };
      });
    },
    [persistFavorites],
  );

  const loadNotes = React.useCallback(
    async (refresh = false) => {
      if (loadingRef.current) {
        return;
      }
      loadingRef.current = true;
      if (!refresh) {
        setNotesState({ status: 'loading' });
      }
      try {
        const { search, tags } = filtersRef.current;
        const offset = pageRef.current * PAGE_SIZE;
        const response = await client.listNodes({
          limit: PAGE_SIZE,
          offset,
          search: search.trim().length > 0 ? search.trim() : undefined,
          tags: tags.length > 0 ? tags : undefined,
        });
        // If the requested page is out of range adjust to the last available page.
        if (
          typeof response.total === 'number' &&
          response.total >= 0 &&
          response.total < offset &&
          pageRef.current > 0
        ) {
          const lastPage = Math.max(0, Math.ceil(response.total / PAGE_SIZE) - 1);
          loadingRef.current = false;
          setPage(lastPage);
          return;
        }
        setNotesState({ status: 'ready', response });
        if (refresh) {
          setEventError(undefined);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        let reusedPrevious = false;
        setNotesState((prev) => {
          if (refresh && prev.status === 'ready') {
            reusedPrevious = true;
            return prev;
          }
          return { status: 'error', error: message };
        });
        if (refresh && reusedPrevious) {
          setEventError(message);
        }
      } finally {
        loadingRef.current = false;
      }
    },
    [client],
  );

  const loadTags = React.useCallback(
    async (silent = false) => {
      if (tagLoadingRef.current) {
        return;
      }
      tagLoadingRef.current = true;
      if (!silent) {
        setTagState((prev) =>
          prev.status === 'ready' ? prev : { status: 'loading', tags: prev.tags ?? [] },
        );
      }
      try {
        const tags = await client.listTags({ includeCounts: true, limit: 200 });
        const sorted = tags
          .slice()
          .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name));
        setTagState({ status: 'ready', tags: sorted });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setTagState((prev) => {
          if (silent && prev.status === 'ready') {
            return prev;
          }
          return {
            status: 'error',
            tags: prev.tags,
            error: message,
          };
        });
      } finally {
        tagLoadingRef.current = false;
      }
    },
    [client],
  );

  React.useEffect(() => {
    loadNotes(false).catch(() => undefined);
  }, [loadNotes, filters, page]);

  React.useEffect(() => {
    loadTags(false).catch(() => undefined);
  }, [loadTags]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const favorites = await loadTagFavorites();
        if (!cancelled) {
          favoritesRef.current = favorites;
          setFavoritesState({ status: 'ready', favorites });
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setFavoritesState({ status: 'error', favorites: [], error: message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  React.useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  React.useEffect(() => {
    pageRef.current = page;
  }, [page]);

  const recordFavorite = React.useCallback(
    (tags: string[], options?: { onlyBump?: boolean }) => {
      const normalized = dedupeTagsCaseInsensitive(tags);
      if (normalized.length === 0) {
        return;
      }
      applyFavoriteUpdate((current) => upsertFavoriteRecords(current, normalized, options));
    },
    [applyFavoriteUpdate],
  );

  const removeFavorite = React.useCallback(
    (index: number) => {
      applyFavoriteUpdate((current) => removeFavoriteAtIndex(current, index));
    },
    [applyFavoriteUpdate],
  );

  const renameFavorites = React.useCallback(
    (oldName: string, newName: string) => {
      applyFavoriteUpdate((current) => renameFavoritesForTag(current, oldName, newName));
    },
    [applyFavoriteUpdate],
  );

  React.useEffect(() => {
    const prev = prevTagsRef.current;
    if (!areTagArraysEqual(prev, filters.tags)) {
      prevTagsRef.current = filters.tags;
      if (filters.tags.length > 0) {
        recordFavorite(filters.tags);
      }
    }
  }, [filters.tags, recordFavorite]);

  React.useEffect(() => {
    if (notesState.status !== 'ready') {
      if (selectedId !== undefined) {
        setSelectedId(undefined);
      }
      return;
    }
    const items = notesState.response.items;
    if (items.length === 0) {
      if (selectedId !== undefined) {
        setSelectedId(undefined);
      }
      return;
    }
    if (!selectedId || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0]?.id);
    }
  }, [notesState, selectedId]);

  const selectedNode =
    notesState.status === 'ready'
      ? notesState.response.items.find((item) => item.id === selectedId)
      : undefined;

  React.useEffect(() => {
    if (!selectedNode) {
      setContentState((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }));
      setDetailState((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }));
      return;
    }

    const contentForceRefresh = forcedRefreshId === selectedNode.id;
    if (contentForceRefresh) {
      setForcedRefreshId(undefined);
      client.evictNodeContent(selectedNode.id);
    }
    const cachedContent = contentForceRefresh
      ? undefined
      : client.getCachedNodeContent(selectedNode.id);
    if (cachedContent) {
      setContentState({ status: 'ready', id: selectedNode.id, content: cachedContent });
    } else {
      setContentState({ status: 'loading', id: selectedNode.id });
    }

    const detailForceRefresh = forcedDetailRefreshId === selectedNode.id;
    if (detailForceRefresh) {
      setForcedDetailRefreshId(undefined);
      client.evictNodeDetail(selectedNode.id);
    }
    const cachedDetail = detailForceRefresh
      ? undefined
      : client.getCachedNodeDetail(selectedNode.id);
    if (cachedDetail) {
      setDetailState({ status: 'ready', id: selectedNode.id, detail: cachedDetail });
    } else {
      setDetailState({ status: 'loading', id: selectedNode.id });
    }

    let cancelled = false;
    client
      .getNodeContent(selectedNode.id, { forceRefresh: contentForceRefresh })
      .then((content) => {
        if (!cancelled) {
          setContentState({ status: 'ready', id: selectedNode.id, content });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setContentState({
            status: 'error',
            id: selectedNode.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    client
      .getNodeDetail(selectedNode.id, {
        includeBody: false,
        includeEdges: true,
        includeSuggestions: true,
        edgesLimit: 12,
        suggestionsLimit: 12,
        forceRefresh: detailForceRefresh,
      })
      .then((detail) => {
        if (!cancelled) {
          setDetailState({ status: 'ready', id: selectedNode.id, detail });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDetailState({
            status: 'error',
            id: selectedNode.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, selectedNode, forcedRefreshId, forcedDetailRefreshId]);

  React.useEffect(() => {
    let active = true;
    const unsubscribe = client.subscribeToEvents(
      async (event: ForestEvent) => {
        if (!active || !event || typeof event.type !== 'string') {
          return;
        }
        if (event.type.startsWith('tag:')) {
          await loadTags(true).catch(() => undefined);
          if (event.type === 'tag:renamed') {
            const oldName = (event as { old?: string }).old;
            const newName = (event as { new?: string }).new;
            if (oldName && newName) {
              setFilters((prev) => {
                const updated = prev.tags.map((tag) =>
                  normalizeTagName(tag) === normalizeTagName(oldName) ? newName : tag,
                );
                const deduped = dedupeTagsCaseInsensitive(updated);
                if (areTagArraysEqual(prev.tags, deduped)) {
                  return prev;
                }
                return { ...prev, tags: deduped };
              });
              renameFavorites(oldName, newName);
              setPage(0);
            }
          }
          return;
        }

        if (event.type.startsWith('edge:')) {
          const nodeIds = extractEdgeNodeIds(event);
          if (nodeIds.length > 0) {
            nodeIds.forEach((nodeId) => {
              client.evictNodeDetail(nodeId);
              if (selectedIdRef.current === nodeId) {
                setForcedDetailRefreshId(nodeId);
              }
            });
          }
          await loadNotes(true).catch(() => undefined);
          return;
        }

        if (!event.type.startsWith('node:')) {
          return;
        }
        await loadNotes(true).catch(() => undefined);
        if (!active) {
          return;
        }
        loadTags(true).catch(() => undefined);
        if (
          (event.type === 'node:created' || event.type === 'node:updated') &&
          event.node &&
          typeof (event.node as ForestNodeContent).id === 'string'
        ) {
          const nodeId = (event.node as ForestNodeContent).id;
          if (selectedIdRef.current === nodeId) {
            setForcedRefreshId(nodeId);
            setForcedDetailRefreshId(nodeId);
          } else {
            client.getNodeContent(nodeId, { forceRefresh: true }).catch(() => undefined);
            client.evictNodeDetail(nodeId);
          }
        }
        if (event.type === 'node:deleted') {
          const nodeId =
            (event as { nodeId?: string }).nodeId ||
            (event as { id?: string }).id ||
            (event as { node?: { id?: string } }).node?.id;
          if (typeof nodeId === 'string') {
            client.evictNodeContent(nodeId);
            client.evictNodeDetail(nodeId);
            if (selectedIdRef.current === nodeId) {
              setContentState({ status: 'idle' });
              setDetailState({ status: 'idle' });
            }
          }
        }
      },
      {
        onStatusChange: (status) => {
          setEventStatus(status);
          if (status === 'connected') {
            setEventError(undefined);
          }
        },
        onError: (error) => {
          setEventError(error.message);
        },
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client, loadNotes, loadTags, renameFavorites]);


  const eventStatusColor =
    eventStatus === 'connected' ? 'greenBright' : eventStatus === 'connecting' ? 'yellow' : 'red';
  const eventStatusLabel =
    eventStatus === 'connected' ? 'live' : eventStatus === 'connecting' ? 'connecting…' : 'offline';

  const offset = page * PAGE_SIZE;
  const total = notesState.status === 'ready' ? notesState.response.total : undefined;
  const currentItems = notesState.status === 'ready' ? notesState.response.items : [];
  const availableTags = tagState.tags;
  const tagSuggestions = React.useMemo(() => {
    if (inputMode !== 'tags') {
      return [] as ForestTagListItem[];
    }
    const tokens = getDraftTagTokens(draftInput);
    const committed = tokens.slice(0, Math.max(0, tokens.length - 1));
    const currentToken = tokens[tokens.length - 1] ?? '';
    const used = new Set<string>([
      ...filters.tags.map(normalizeTagName),
      ...committed.map(normalizeTagName).filter((value) => value.length > 0),
    ]);
    const pool = availableTags.filter((tag) => !used.has(normalizeTagName(tag.name)));
    const filtered = currentToken
      ? pool.filter((tag) => normalizeTagName(tag.name).includes(normalizeTagName(currentToken)))
      : pool;
    return filtered.slice(0, 5);
  }, [availableTags, draftInput, filters.tags, inputMode]);

  React.useEffect(() => {
    if (tagSuggestions.length === 0) {
      setTagSuggestionIndex(0);
    } else {
      setTagSuggestionIndex((prev) => Math.min(prev, tagSuggestions.length - 1));
    }
  }, [tagSuggestions.length]);

  React.useEffect(() => {
    if (inputMode !== 'tags') {
      setTagSuggestionIndex(0);
    }
  }, [inputMode]);

  React.useEffect(() => {
    const length = favoritesState.favorites.length;
    setFavoriteIndex((prev) => {
      if (length === 0) {
        return 0;
      }
      return Math.min(prev, length - 1);
    });
  }, [favoritesState.favorites.length]);

  const favoritesList = favoritesState.favorites;

  useInput((input, key) => {
    if (inputMode === 'search' || inputMode === 'tags') {
      if (inputMode === 'tags') {
        if ((key.upArrow || input === 'k') && tagSuggestions.length > 0) {
          setTagSuggestionIndex((prev) => (prev - 1 + tagSuggestions.length) % tagSuggestions.length);
          return;
        }
        if ((key.downArrow || input === 'j') && tagSuggestions.length > 0) {
          setTagSuggestionIndex((prev) => (prev + 1) % tagSuggestions.length);
          return;
        }
        if (key.tab && tagSuggestions.length > 0) {
          setDraftInput((prev) => applyTagSuggestion(prev, tagSuggestions[tagSuggestionIndex].name));
          setTagSuggestionIndex(0);
          return;
        }
      }
      if (key.escape) {
        setInputMode('normal');
        setDraftInput('');
        setTagSuggestionIndex(0);
        return;
      }
      if (key.return) {
        if (inputMode === 'tags') {
          const tokens = getDraftTagTokens(draftInput);
          const currentToken = tokens[tokens.length - 1] ?? '';
          if (tagSuggestions.length > 0 && currentToken.length > 0) {
            setDraftInput((prev) =>
              applyTagSuggestion(prev, tagSuggestions[tagSuggestionIndex].name),
            );
            setTagSuggestionIndex(0);
            return;
          }
          const tags = parseTags(draftInput);
          setFilters((prev) => (areTagArraysEqual(prev.tags, tags) ? prev : { ...prev, tags }));
        } else {
          const trimmed = draftInput.trim();
          setFilters((prev) => (prev.search === trimmed ? prev : { ...prev, search: trimmed }));
        }
        setPage(0);
        setInputMode('normal');
        setDraftInput('');
        setTagSuggestionIndex(0);
        return;
      }
      if (key.backspace || key.delete) {
        setDraftInput((prev) => prev.slice(0, Math.max(0, prev.length - 1)));
        return;
      }
      if (input) {
        setDraftInput((prev) => prev + input);
      }
      return;
    }

    if (inputMode === 'favorites') {
      const favorites = favoritesState.favorites;
      if (key.escape) {
        setInputMode('normal');
        return;
      }
      if ((key.upArrow || input === 'k') && favorites.length > 0) {
        setFavoriteIndex((prev) => (prev - 1 + favorites.length) % favorites.length);
        return;
      }
      if ((key.downArrow || input === 'j') && favorites.length > 0) {
        setFavoriteIndex((prev) => (prev + 1) % favorites.length);
        return;
      }
      if (key.return && favorites.length > 0) {
        const favorite = favorites[favoriteIndex] ?? favorites[0];
        if (favorite) {
          setFilters((prev) => ({ ...prev, tags: favorite.tags }));
          setPage(0);
          recordFavorite(favorite.tags, { onlyBump: true });
        }
        setInputMode('normal');
        setDraftInput('');
        setTagSuggestionIndex(0);
        return;
      }
      if ((key.backspace || key.delete || input === 'x' || input === 'X') && favorites.length > 0) {
        removeFavorite(favoriteIndex);
        setFavoriteIndex((prev) => {
          const nextLength = Math.max(0, favorites.length - 1);
          if (nextLength === 0) {
            return 0;
          }
          return Math.min(prev, nextLength - 1);
        });
        return;
      }
      return;
    }

    if (input === '/' && inputMode === 'normal') {
      setInputMode('search');
      setDraftInput(filters.search);
      return;
    }
    if ((input === 't' || input === 'T') && inputMode === 'normal') {
      setInputMode('tags');
      setDraftInput(filters.tags.join(', '));
      setTagSuggestionIndex(0);
      return;
    }
    if ((input === 'f' || input === 'F') && inputMode === 'normal') {
      setInputMode('favorites');
      setFavoriteIndex(0);
      return;
    }

    if (key.leftArrow || input === 'h') {
      if (page > 0) {
        setPage((prev) => Math.max(0, prev - 1));
      }
      return;
    }
    if (key.rightArrow || input === 'l') {
      const hasMore =
        (typeof total === 'number' && (page + 1) * PAGE_SIZE < total) ||
        (typeof total !== 'number' && currentItems.length === PAGE_SIZE);
      if (hasMore) {
        setPage((prev) => prev + 1);
      }
      return;
    }

    if (notesState.status !== 'ready' || currentItems.length === 0) {
      return;
    }
    const items = currentItems;
    const currentIndex = selectedNode ? items.findIndex((item) => item.id === selectedNode.id) : -1;
    if (key.upArrow || input === 'k') {
      const nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
      if (items[nextIndex] && items[nextIndex].id !== selectedId) {
        setSelectedId(items[nextIndex].id);
      }
    } else if (key.downArrow || input === 'j') {
      const nextIndex =
        currentIndex >= 0 ? Math.min(currentIndex + 1, items.length - 1) : items.length - 1;
      if (items[nextIndex] && items[nextIndex].id !== selectedId) {
        setSelectedId(items[nextIndex].id);
      }
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text color="cyan">Notes</Text>
      <Text dimColor>
        Live updates:{' '}
        <Text color={eventStatusColor}>
          {eventStatusLabel}
        </Text>
        {eventError ? ` – ${eventError}` : ''}
      </Text>
      <Text dimColor>
        Filters:{' '}
        {filters.search ? `“${filters.search}”` : 'none'}
        {filters.tags.length > 0 ? ` • tags: ${filters.tags.join(', ')}` : ''}
      </Text>
      {tagState.status === 'error' && inputMode !== 'tags' && (
        <Text color="red">Tag list unavailable: {tagState.error}</Text>
      )}
      {favoritesState.status === 'error' && inputMode !== 'favorites' && (
        <Text color="red">Favorite tag sets unavailable: {favoritesState.error}</Text>
      )}
      <Text dimColor>
        Page {page + 1}
        {typeof total === 'number' ? ` of ${Math.max(1, Math.ceil(total / PAGE_SIZE))}` : ''}
        {currentItems.length > 0
          ? ` • Showing ${offset + 1}-${offset + currentItems.length}${
              typeof total === 'number' ? ` of ${total}` : ''
            }`
          : ''}
      </Text>
      <Text dimColor>
        Shortcuts: / search, t tags, f favorites, Tab/↑/↓ tag suggestions, ←/h prev page, →/l next page, ↑/↓ or j/k navigate, Ctrl+C exit
      </Text>
      {inputMode === 'search' && (
        <Text color="yellow">
          Search:{' '}
          {draftInput.length > 0 ? draftInput : <Text dimColor>(type to search notes)</Text>}
          <Text>▌</Text>
        </Text>
      )}
      {inputMode === 'tags' && (
        <Text color="yellow">
          Tags:{' '}
          {draftInput.length > 0 ? (
            draftInput
          ) : (
            <Text dimColor>(type to enter comma-separated tags)</Text>
          )}
          <Text>▌</Text>
        </Text>
      )}
      {inputMode === 'tags' && tagState.status === 'loading' && (
        <Text dimColor>Loading tags…</Text>
      )}
      {inputMode === 'tags' && tagState.status === 'error' && (
        <Text color="red">Tag list unavailable: {tagState.error}</Text>
      )}
      {inputMode === 'tags' && tagSuggestions.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>Suggestions (Tab/↑/↓ to cycle, Enter to accept):</Text>
          {tagSuggestions.map((tag, index) => (
            <Text
              key={`${tag.name}-${index}`}
              color={index === tagSuggestionIndex ? 'black' : undefined}
              backgroundColor={index === tagSuggestionIndex ? 'cyan' : undefined}
            >
              {index === tagSuggestionIndex ? '› ' : '  '}
              {tag.name}
              {typeof tag.count === 'number' ? ` (${tag.count})` : ''}
            </Text>
          ))}
        </Box>
      )}
      {inputMode === 'tags' &&
        draftInput.length > 0 &&
        tagSuggestions.length === 0 &&
        tagState.status === 'ready' && (
          <Text dimColor>No matching tags.</Text>
        )}
      {inputMode === 'favorites' && (
        <Box
          flexDirection="column"
          gap={1}
          borderStyle="round"
          borderColor="magenta"
          paddingX={1}
          paddingY={0}
        >
          <Text color="magenta">Favorite tag sets</Text>
          {favoritesState.status === 'loading' && <Text dimColor>Loading favorites…</Text>}
          {favoritesState.status === 'error' && (
            <Text color="red">Unable to load favorites: {favoritesState.error}</Text>
          )}
          {favoritesList.length === 0 && favoritesState.status !== 'loading' && (
            <Text dimColor>
              No favorites yet. Apply tag filters and Camper will remember them automatically.
            </Text>
          )}
          {favoritesList.map((favorite, index) => (
            <Text
              key={`${favoriteKey(favorite.tags)}-${index}`}
              color={index === favoriteIndex ? 'black' : undefined}
              backgroundColor={index === favoriteIndex ? 'magenta' : undefined}
            >
              {index === favoriteIndex ? '› ' : '  '}
              {favorite.tags.join(', ')}
              {favorite.usageCount ? ` (${favorite.usageCount})` : ''}
            </Text>
          ))}
          <Text dimColor>Enter apply • x delete • Esc cancel</Text>
        </Box>
      )}
      <Box flexDirection="row" gap={2}>
        <Box flexDirection="column" width={40}>
          {notesState.status === 'loading' && <Text color="yellow">Loading notes…</Text>}
          {notesState.status === 'error' && <Text color="red">{notesState.error}</Text>}
          {notesState.status === 'ready' && notesState.response.items.length === 0 && (
            <Text dimColor>No notes yet. Capture something with `forest capture`.</Text>
          )}
          {notesState.status === 'ready' &&
            notesState.response.items.map((item) => (
              <NoteListItem key={item.id} item={item} selected={item.id === selectedId} />
            ))}
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Text dimColor>Arrow keys / j,k to navigate. Press Ctrl+C to exit.</Text>
          <Box marginTop={1}>
            <NoteDetail contentState={contentState} detailState={detailState} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function NoteListItem({
  item,
  selected,
}: {
  item: ForestNodeListItem;
  selected: boolean;
}): React.ReactElement {
  const preview =
    item.bodyPreview?.replace(/\s+/g, ' ').slice(0, 80) ||
    (typeof item.bodyLength === 'number' ? `${item.bodyLength} characters` : 'Empty body');
  return (
    <Box flexDirection="column" paddingLeft={selected ? 0 : 1}>
      <Text color={selected ? 'black' : undefined} backgroundColor={selected ? 'cyan' : undefined}>
        {item.title || '(Untitled note)'}
      </Text>
      <Text dimColor>{preview}</Text>
      {item.tags.length > 0 && (
        <Text dimColor>
          #{item.tags.join(' #')}
        </Text>
      )}
    </Box>
  );
}

function NoteDetail({
  contentState,
  detailState,
}: {
  contentState: ContentState;
  detailState: DetailState;
}): React.ReactElement {
  if (contentState.status === 'idle') {
    return <Text dimColor>Select a note to read it.</Text>;
  }
  if (contentState.status === 'loading') {
    return <Text color="yellow">Loading note…</Text>;
  }
  if (contentState.status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">Unable to load note.</Text>
        <Text>{contentState.error}</Text>
      </Box>
    );
  }
  const { content } = contentState;
  const detailLoading =
    detailState.status === 'loading' && detailState.id === content.id;
  const detailError =
    detailState.status === 'error' && detailState.id === content.id
      ? detailState.error
      : undefined;
  const detail =
    detailState.status === 'ready' && detailState.id === content.id
      ? detailState.detail
      : undefined;

  return (
    <Box flexDirection="column" gap={1}>
      <Text color="greenBright">{content.title || '(Untitled note)'}</Text>
      {content.tags.length > 0 && (
        <Text color="cyan">
          #{content.tags.join(' #')}
        </Text>
      )}
      <Text dimColor>
        {formatTimestamp(content.createdAt)}{' '}
        {content.bodyLength != null ? `• ${formatBodyLength(content.bodyLength)}` : ''}
      </Text>
      <Text>{content.body}</Text>
      <EdgesSection
        edges={detail?.edges ?? []}
        suggestions={detail?.suggestions ?? []}
        edgesTotal={detail?.edgesTotal}
        suggestionsTotal={detail?.suggestionsTotal}
        loading={detailLoading}
        error={detailError}
      />
    </Box>
  );
}

function EdgesSection({
  edges,
  suggestions,
  edgesTotal,
  suggestionsTotal,
  loading,
  error,
}: {
  edges: ForestEdgeRecord[];
  suggestions: ForestEdgeRecord[];
  edgesTotal?: number;
  suggestionsTotal?: number;
  loading: boolean;
  error?: string;
}): React.ReactElement {
  if (!loading && !error && edges.length === 0 && suggestions.length === 0) {
    return <Text dimColor>No relationships yet.</Text>;
  }
  return (
    <Box flexDirection="column" gap={1}>
      <Text color="cyan">Relationships</Text>
      {loading && <Text dimColor>Refreshing relationships…</Text>}
      {error && <Text color="red">Unable to load relationships: {error}</Text>}
      {!loading && !error && edges.length > 0 && (
        <Box flexDirection="column" gap={0}>
          <Text color="greenBright">
            Accepted {formatEdgeTotals(edges.length, edgesTotal)}
          </Text>
          {edges.map((edge, index) => (
            <Text key={edge.id ?? `${edge.sourceId}-${edge.targetId}-${index}`}>
              {formatEdgeSummary(edge, 'accepted')}
            </Text>
          ))}
        </Box>
      )}
      {!loading && !error && suggestions.length > 0 && (
        <Box flexDirection="column" gap={0}>
          <Text color="yellow">
            Suggestions {formatEdgeTotals(suggestions.length, suggestionsTotal)}
          </Text>
          {suggestions.map((edge, index) => (
            <Text key={edge.id ?? `${edge.sourceId}-${edge.targetId}-suggestion-${index}`}>
              {formatEdgeSummary(edge, 'suggested')}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function formatEdgeTotals(visible: number, total?: number): string {
  if (typeof total === 'number' && total > visible) {
    return `(${visible} of ${total})`;
  }
  return `(${visible})`;
}

function formatEdgeSummary(edge: ForestEdgeRecord, variant: 'accepted' | 'suggested'): string {
  const arrow =
    edge.direction === 'out'
      ? '→'
      : edge.direction === 'in'
      ? '←'
      : edge.direction === 'bidirectional'
      ? '↔'
      : '•';
  const candidateTitles = [edge.toTitle, edge.fromTitle, edge.label, edge.targetId, edge.sourceId, edge.id];
  const title = candidateTitles.find((value) => typeof value === 'string' && value.length > 0) ||
    (variant === 'suggested' ? 'Suggested link' : 'Related note');
  const score = typeof edge.score === 'number' ? ` • score ${edge.score.toFixed(2)}` : '';
  const status = edge.status && edge.status !== 'accepted' ? ` (${edge.status})` : '';
  return `${arrow} ${title}${status}${score}`;
}

function formatTimestamp(timestamp?: string): string {
  if (!timestamp) {
    return 'Unknown date';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) {
    return timestamp;
  }
  return date.toLocaleString();
}

function formatBodyLength(length: number): string {
  if (length >= 1000) {
    return `${(length / 1000).toFixed(1)}k chars`;
  }
  return `${length} chars`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '';
  }
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) {
    return `${hrs}h${mins > 0 ? ` ${mins}m` : ''}`;
  }
  if (mins > 0) {
    return `${mins}m`;
  }
  return `${Math.floor(seconds)}s`;
}

function getDraftTagTokens(input: string): string[] {
  if (input.length === 0) {
    return [''];
  }
  return input.split(',').map((token) => token.trim().replace(/^#/, ''));
}

function normalizeTagName(name: string): string {
  return name.trim().replace(/^#/, '').toLowerCase();
}

function dedupeTagsCaseInsensitive(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    const normalized = normalizeTagName(trimmed);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(trimmed);
  }
  return result;
}

function applyTagSuggestion(draft: string, suggestion: string): string {
  const tokens = getDraftTagTokens(draft);
  if (tokens.length === 0) {
    return `${suggestion}, `;
  }
  tokens[tokens.length - 1] = suggestion;
  const deduped = dedupeTagsCaseInsensitive(tokens);
  const joined = deduped.join(', ');
  return joined.length > 0 ? `${joined}, ` : '';
}

function areTagArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (normalizeTagName(a[i]) !== normalizeTagName(b[i])) {
      return false;
    }
  }
  return true;
}

const MAX_FAVORITES = 15;

function favoriteKey(tags: string[]): string {
  return tags.map((tag) => normalizeTagName(tag)).join('|');
}

function truncateFavorites(favorites: TagFavoriteRecord[]): TagFavoriteRecord[] {
  if (favorites.length <= MAX_FAVORITES) {
    return favorites;
  }
  return favorites.slice(0, MAX_FAVORITES);
}

function upsertFavoriteRecords(
  current: TagFavoriteRecord[],
  tags: string[],
  options?: { onlyBump?: boolean },
): TagFavoriteRecord[] | null {
  const key = favoriteKey(tags);
  const now = new Date().toISOString();
  const existingIndex = current.findIndex((favorite) => favoriteKey(favorite.tags) === key);
  if (existingIndex >= 0) {
    const existing = current[existingIndex];
    const updatedFavorite: TagFavoriteRecord = {
      tags,
      usageCount: existing.usageCount + 1,
      lastUsedAt: now,
    };
    const without = current.slice(0, existingIndex).concat(current.slice(existingIndex + 1));
    const updated = [updatedFavorite, ...without];
    return truncateFavorites(updated);
  }
  if (options?.onlyBump) {
    return null;
  }
  const newFavorite: TagFavoriteRecord = {
    tags,
    usageCount: 1,
    lastUsedAt: now,
  };
  return truncateFavorites([newFavorite, ...current]);
}

function removeFavoriteAtIndex(
  current: TagFavoriteRecord[],
  index: number,
): TagFavoriteRecord[] | null {
  if (index < 0 || index >= current.length) {
    return null;
  }
  const updated = current.slice(0, index).concat(current.slice(index + 1));
  return updated;
}

function renameFavoritesForTag(
  current: TagFavoriteRecord[],
  oldName: string,
  newName: string,
): TagFavoriteRecord[] | null {
  const normalizedOld = normalizeTagName(oldName);
  const cleanedNew = newName.trim();
  if (!cleanedNew || normalizedOld === normalizeTagName(cleanedNew)) {
    return null;
  }
  let changed = false;
  const merged = new Map<string, TagFavoriteRecord>();
  for (const favorite of current) {
    const updatedTags = favorite.tags.map((tag) =>
      normalizeTagName(tag) === normalizedOld ? cleanedNew : tag,
    );
    if (!areTagArraysEqual(favorite.tags, updatedTags)) {
      changed = true;
    }
    const normalizedTags = dedupeTagsCaseInsensitive(updatedTags);
    if (normalizedTags.length === 0) {
      continue;
    }
    const key = favoriteKey(normalizedTags);
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, {
        tags: normalizedTags,
        usageCount: existing.usageCount + favorite.usageCount,
        lastUsedAt:
          new Date(existing.lastUsedAt).valueOf() > new Date(favorite.lastUsedAt).valueOf()
            ? existing.lastUsedAt
            : favorite.lastUsedAt,
      });
    } else {
      merged.set(key, {
        tags: normalizedTags,
        usageCount: favorite.usageCount,
        lastUsedAt: favorite.lastUsedAt,
      });
    }
  }
  if (!changed) {
    return null;
  }
  const updated = Array.from(merged.values()).sort((a, b) => {
    const dateDiff = new Date(b.lastUsedAt).valueOf() - new Date(a.lastUsedAt).valueOf();
    if (dateDiff !== 0) {
      return dateDiff;
    }
    return b.usageCount - a.usageCount;
  });
  return truncateFavorites(updated);
}

function extractEdgeNodeIds(event: ForestEvent): string[] {
  const ids = new Set<string>();
  const edgeCandidate = (event as { edge?: Record<string, unknown> }).edge;
  if (edgeCandidate && typeof edgeCandidate === 'object') {
    const sourceId = normalizePossibleId(
      edgeCandidate.sourceId ??
        edgeCandidate.fromId ??
        (edgeCandidate.source as { id?: unknown })?.id,
    );
    const targetId = normalizePossibleId(
      edgeCandidate.targetId ??
        edgeCandidate.toId ??
        (edgeCandidate.target as { id?: unknown })?.id,
    );
    if (sourceId) {
      ids.add(sourceId);
    }
    if (targetId) {
      ids.add(targetId);
    }
  }
  const nodeId = normalizePossibleId((event as { nodeId?: unknown }).nodeId);
  if (nodeId) {
    ids.add(nodeId);
  }
  return Array.from(ids);
}

function normalizePossibleId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseTags(input: string): string[] {
  const tokens = getDraftTagTokens(input);
  return dedupeTagsCaseInsensitive(tokens);
}
