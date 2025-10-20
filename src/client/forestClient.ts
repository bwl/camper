import WebSocket from 'ws';
import {
  ForestApiEnvelope,
  ForestClientOptions,
  ForestHealthResponse,
  ForestNodeContent,
  ForestNodeListItem,
  ForestNodeListResponse,
  ForestTagListItem,
  ForestTagListResponse,
  ForestNodeDetail,
  ForestEdgeRecord,
  ForestEvent,
  ForestStatsResponse,
  ForestStatsRecentNode,
  ForestStatsTopTag,
  ForestStatsTopSuggestion,
  ForestStatsHighDegreeNode,
  ListNodesParams,
  ListTagsParams,
  NodeContentRequestOptions,
  NodeDetailRequestOptions,
  EventStreamOptions,
} from './types.js';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export class ForestClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly contentCache = new Map<string, ForestNodeContent>();
  private readonly detailCache = new Map<string, ForestNodeDetail>();
  private readonly apiPrefix: string;

  constructor(options: ForestClientOptions) {
    this.baseUrl = this.normalizeBaseUrl(options.baseUrl);
    this.timeoutMs = options.timeoutMs;
    this.apiPrefix = this.normalizeApiPrefix(options.apiPrefix);
  }

  async getHealth(): Promise<ForestHealthResponse> {
    const payload = await this.request<Record<string, unknown>>('health');
    return this.normalizeHealth(payload);
  }

  async getStats(): Promise<ForestStatsResponse> {
    const payload = await this.request<Record<string, unknown>>('stats');
    return this.normalizeStats(payload);
  }

  async listNodes(params?: ListNodesParams): Promise<ForestNodeListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.limit != null) {
      searchParams.set('limit', String(params.limit));
    }
    if (params?.offset != null) {
      searchParams.set('offset', String(params.offset));
    }
    if (params?.search) {
      searchParams.set('search', params.search);
    }
    if (params?.tags?.length) {
      for (const tag of params.tags) {
        searchParams.append('tags', tag);
      }
    }
    const query = searchParams.toString();
    const payload = await this.request<
      ForestNodeListResponse | ForestNodeListItem[] | { nodes: ForestNodeListItem[]; total?: number; limit?: number; offset?: number }
    >(`nodes${query ? `?${query}` : ''}`);

    if (Array.isArray(payload)) {
      return { items: payload };
    }
    if (payload && Array.isArray((payload as ForestNodeListResponse).items)) {
      const typed = payload as ForestNodeListResponse;
      return {
        items: typed.items,
        total: typed.total,
        limit: typed.limit,
        offset: typed.offset,
      };
    }
    if (payload && Array.isArray((payload as { nodes?: ForestNodeListItem[] }).nodes)) {
      const typed = payload as { nodes: ForestNodeListItem[]; total?: number; limit?: number; offset?: number };
      return {
        items: typed.nodes,
        total: typed.total,
        limit: typed.limit,
        offset: typed.offset,
      };
    }
    throw new Error('Unexpected response shape from /nodes endpoint');
  }

  async listTags(params?: ListTagsParams): Promise<ForestTagListItem[]> {
    const searchParams = new URLSearchParams();
    if (params?.limit != null) {
      searchParams.set('limit', String(params.limit));
    }
    if (params?.offset != null) {
      searchParams.set('offset', String(params.offset));
    }
    if (params?.search) {
      searchParams.set('search', params.search);
    }
    if (params?.includeCounts) {
      searchParams.set('includeCounts', String(params.includeCounts));
    }
    const query = searchParams.toString();
    const payload = await this.request<ForestTagListResponse | ForestTagListItem[] | { tags: ForestTagListItem[] }>(
      `tags${query ? `?${query}` : ''}`,
    );
    if (Array.isArray(payload)) {
      return payload;
    }
    if (payload && Array.isArray((payload as ForestTagListResponse).items)) {
      return (payload as ForestTagListResponse).items;
    }
    if (payload && Array.isArray((payload as { tags?: ForestTagListItem[] }).tags)) {
      return (payload as { tags: ForestTagListItem[] }).tags;
    }
    throw new Error('Unexpected response shape from /tags endpoint');
  }

  async getNodeContent(id: string, options?: NodeContentRequestOptions): Promise<ForestNodeContent> {
    if (!id) {
      throw new Error('Node id is required');
    }
    if (!options?.forceRefresh) {
      const cached = this.contentCache.get(id);
      if (cached) {
        return cached;
      }
    }
    const content = await this.request<ForestNodeContent>(`nodes/${encodeURIComponent(id)}/content`);
    this.contentCache.set(id, content);
    return content;
  }

  getCachedNodeContent(id: string): ForestNodeContent | undefined {
    return this.contentCache.get(id);
  }

  evictNodeContent(id: string): void {
    this.contentCache.delete(id);
  }

  clearNodeContentCache(): void {
    this.contentCache.clear();
  }

  async getNodeDetail(id: string, options?: NodeDetailRequestOptions): Promise<ForestNodeDetail> {
    if (!id) {
      throw new Error('Node id is required');
    }
    if (!options?.forceRefresh) {
      const cached = this.detailCache.get(id);
      if (cached) {
        return cached;
      }
    }
    const searchParams = new URLSearchParams();
    if (options?.includeBody === false) {
      searchParams.set('includeBody', 'false');
    }
    if (options?.includeEdges === false) {
      searchParams.set('includeEdges', 'false');
    }
    if (options?.includeSuggestions === false) {
      searchParams.set('includeSuggestions', 'false');
    }
    if (options?.edgesLimit != null) {
      searchParams.set('edgesLimit', String(options.edgesLimit));
    }
    if (options?.suggestionsLimit != null) {
      searchParams.set('suggestionsLimit', String(options.suggestionsLimit));
    }
    const query = searchParams.toString();
    const payload = await this.request<ForestNodeDetail | Record<string, unknown>>(
      `nodes/${encodeURIComponent(id)}${query ? `?${query}` : ''}`,
    );
    const detail = this.normalizeNodeDetail(payload, id);
    this.detailCache.set(id, detail);
    return detail;
  }

  getCachedNodeDetail(id: string): ForestNodeDetail | undefined {
    return this.detailCache.get(id);
  }

  evictNodeDetail(id: string): void {
    this.detailCache.delete(id);
  }

  clearNodeDetailCache(): void {
    this.detailCache.clear();
  }

  subscribeToEvents(handler: (event: ForestEvent) => void, options: EventStreamOptions = {}): () => void {
    const retryDelay = options.retryDelayMs ?? 5000;
    const wsPath = options.path ?? '/ws';
    let closed = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: NodeJS.Timeout | undefined;

    const connect = () => {
      if (closed) {
        return;
      }
      options.onStatusChange?.('connecting');
      const url = this.buildWsUrl(wsPath);
      socket = new WebSocket(url, options.protocols);

      socket.on('open', () => {
        options.onStatusChange?.('connected');
        options.onOpen?.();
      });

      socket.on('message', (data) => {
        try {
          const text = this.decodeMessage(data);
          const parsed = JSON.parse(text) as ForestApiEnvelope<ForestEvent>;
          const event = this.unwrap(parsed);
          if (event && typeof event === 'object' && typeof event.type === 'string') {
            handler(event as ForestEvent);
          }
        } catch (error) {
          options.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      });

      socket.on('error', (error) => {
        options.onError?.(error instanceof Error ? error : new Error(String(error)));
      });

      socket.on('close', () => {
        options.onClose?.();
        options.onStatusChange?.('disconnected');
        if (!closed) {
          reconnectTimer = setTimeout(connect, retryDelay);
        }
      });
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      } else if (socket) {
        socket.terminate();
      }
    };
  }

  private async request<T>(path: string, method: HttpMethod = 'GET', body?: unknown): Promise<T> {
    const resolvedPath = this.buildApiPath(path);
    const url = this.buildHttpUrl(resolvedPath);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    if (process.env.DEBUG_FOREST_CLIENT) {
      console.log(`[ForestClient] ${method} ${url}`);
    }

    try {
      const response = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (process.env.DEBUG_FOREST_CLIENT) {
        console.log(`[ForestClient] Response: ${response.status} ${response.statusText}`);
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Forest request failed (${response.status} ${response.statusText}): ${text}`);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const json = (await response.json()) as ForestApiEnvelope<T>;
      return this.unwrap(json);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Forest request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeHealth(source: unknown): ForestHealthResponse {
    const payload = (source && typeof source === 'object') ? (source as Record<string, unknown>) : {};
    const status = this.coerceString(payload.status);
    const okValue = typeof payload.ok === 'boolean' ? payload.ok : undefined;
    const ok = okValue ?? (status ? status.toLowerCase() === 'healthy' || status.toLowerCase() === 'ok' : true);
    const meta = (payload.meta && typeof payload.meta === 'object') ? (payload.meta as Record<string, unknown>) : undefined;
    const database = (payload.database && typeof payload.database === 'object') ? (payload.database as Record<string, unknown>) : undefined;
    const version = this.coerceString(payload.version ?? meta?.version);
    const databasePath = this.coerceString(payload.databasePath ?? database?.path);
    const message = this.coerceString(payload.message ?? payload.statusMessage ?? meta?.message);
    const uptimeSeconds = this.coerceNumber(payload.uptime ?? payload.uptimeSeconds ?? meta?.uptimeSeconds);
    return {
      ok,
      status,
      version,
      databasePath,
      message,
      uptimeSeconds,
    };
  }

  private normalizeStats(source: unknown): ForestStatsResponse {
    const payload = this.toRecord(source) ?? {};
    const counts = this.toRecord(payload.counts);

    const nodesRaw = payload.nodes ?? counts?.nodes;
    const edgesRaw = payload.edges ?? counts?.edges;
    const tagsRaw = payload.tags ?? counts?.tags;
    const suggestionsRaw =
      payload.suggestions ?? counts?.suggestions ?? payload.suggestedEdges ?? edgesRaw;

    const nodesSection = this.extractSection(nodesRaw);
    const edgesSection = this.extractSection(edgesRaw);
    const tagsSection = this.extractSection(tagsRaw);
    const suggestionsSection = this.extractSection(suggestionsRaw);

    const nodes =
      this.coerceNumber(payload.nodes) ??
      this.coerceNumber(counts?.nodes) ??
      nodesSection.total ??
      nodesSection.accepted;
    const edges =
      this.coerceNumber(payload.edges) ??
      this.coerceNumber(counts?.edges) ??
      edgesSection.total ??
      edgesSection.accepted;
    const tags =
      this.coerceNumber(payload.tags) ??
      this.coerceNumber(counts?.tags) ??
      tagsSection.total;
    const suggestedEdges =
      this.coerceNumber(payload.suggestedEdges) ??
      this.coerceNumber(counts?.suggested) ??
      suggestionsSection.total ??
      edgesSection.suggested;

    const nodesRecord = this.toRecord(nodesRaw);
    const suggestionsRecord = this.toRecord(suggestionsRaw);

    const recentNodes = this.normalizeRecentNodes(nodesRaw);
    const topTags = this.normalizeTopTags(tagsRaw);
    const topSuggestions = this.normalizeTopSuggestions(suggestionsRaw);
    const highDegreeNodes = this.normalizeHighDegreeNodes(payload.highDegreeNodes);

    const recentCount =
      this.coerceNumber(payload.recentCount) ??
      this.coerceNumber(nodesRecord?.recentCount) ??
      (recentNodes.length > 0 ? recentNodes.length : undefined);
    const highScoreSuggestionCount =
      this.coerceNumber(payload.highScoreCount) ??
      this.coerceNumber(suggestionsRecord?.highScoreCount) ??
      (topSuggestions.length > 0 ? topSuggestions.length : undefined);

    return {
      nodes,
      edges,
      suggestedEdges,
      tags,
      recentCount,
      highScoreSuggestionCount,
      recentNodes,
      topTags,
      topSuggestions,
      highDegreeNodes,
    };
  }

  private extractSection(input: unknown): {
    total?: number;
    accepted?: number;
    suggested?: number;
  } {
    if (!input || typeof input !== 'object') {
      return {};
    }
    const record = input as Record<string, unknown>;
    return {
      total: this.coerceNumber(record.total ?? record.count ?? record.length),
      accepted: this.coerceNumber(record.accepted),
      suggested: this.coerceNumber(record.suggested ?? record.pending),
    };
  }

  private normalizeNodeDetail(
    payload: ForestNodeDetail | Record<string, unknown>,
    nodeId: string,
  ): ForestNodeDetail {
    const source = (payload ?? {}) as Record<string, unknown>;
    const id = this.coerceString(source.id) || nodeId;
    const title = this.coerceString(source.title);
    const body = this.coerceString(source.body);
    const bodyLength = this.coerceNumber(
      source.bodyLength ?? (source as Record<string, unknown>).body_size,
    );
    const tagsRaw = Array.isArray(source.tags)
      ? source.tags.filter((tag): tag is string => typeof tag === 'string')
      : [];

    const edgesCollection = this.normalizeEdgeCollection(source.edges, id);
    let edges = edgesCollection.items;
    let edgesTotal = this.coerceNumber(
      source.edgesTotal ?? (source.edges as { total?: unknown })?.total ?? edgesCollection.total,
    );

    const suggestionsCollection = this.normalizeEdgeCollection(
      source.suggestions ?? (source.edges as { suggested?: unknown })?.suggested,
      id,
    );
    let suggestions = suggestionsCollection.items;
    let suggestionsTotal = this.coerceNumber(
      source.suggestionsTotal ??
        (source as Record<string, unknown>).suggestedEdgesTotal ??
        suggestionsCollection.total,
    );

    if (edges.length === 0 && source.edges && typeof source.edges === 'object') {
      const accepted = (source.edges as Record<string, unknown>).accepted;
      const acceptedCollection = this.normalizeEdgeCollection(accepted, id);
      edges = acceptedCollection.items;
      edgesTotal = edgesTotal ?? acceptedCollection.total;
      if (suggestions.length === 0) {
        const suggested = (source.edges as Record<string, unknown>).suggested;
        const suggestedCollection = this.normalizeEdgeCollection(suggested, id);
        suggestions = suggestedCollection.items;
        suggestionsTotal = suggestionsTotal ?? suggestedCollection.total;
      }
    }

    if (suggestions.length === 0) {
      const fallback = this.normalizeEdgeCollection(
        (source as Record<string, unknown>).suggestedEdges,
        id,
      );
      if (fallback.items.length > 0) {
        suggestions = fallback.items;
        suggestionsTotal = suggestionsTotal ?? fallback.total;
      }
    }

    if (typeof edgesTotal !== 'number') {
      edgesTotal = edges.length;
    }
    if (typeof suggestionsTotal !== 'number') {
      suggestionsTotal = suggestions.length;
    }

    return {
      id,
      title,
      body,
      tags: tagsRaw,
      bodyLength,
      edges,
      edgesTotal,
      suggestions,
      suggestionsTotal,
    };
  }

  private normalizeEdgeCollection(input: unknown, nodeId: string): {
    items: ForestEdgeRecord[];
    total?: number;
  } {
    if (!input) {
      return { items: [] };
    }
    if (Array.isArray(input)) {
      const items = input
        .map((edge) => this.normalizeEdgeRecord(edge, nodeId))
        .filter((edge): edge is ForestEdgeRecord => edge !== null);
      return { items, total: items.length };
    }
    if (typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      if (Array.isArray(obj.items)) {
        const items = obj.items
          .map((edge) => this.normalizeEdgeRecord(edge, nodeId))
          .filter((edge): edge is ForestEdgeRecord => edge !== null);
        const total = this.coerceNumber(obj.total) ?? items.length;
        return { items, total };
      }
      if (Array.isArray(obj.edges)) {
        const items = obj.edges
          .map((edge) => this.normalizeEdgeRecord(edge, nodeId))
          .filter((edge): edge is ForestEdgeRecord => edge !== null);
        return { items, total: items.length };
      }
    }
    return { items: [] };
  }

  private normalizeEdgeRecord(edge: unknown, nodeId: string): ForestEdgeRecord | null {
    if (!edge || typeof edge !== 'object') {
      return null;
    }
    const record = edge as Record<string, unknown>;
    const sourceId = this.coerceString(
      record.sourceId ??
        record.fromId ??
        record.fromNodeId ??
        (typeof record.source === 'object' && record.source
          ? (record.source as { id?: unknown }).id
          : undefined),
    );
    const targetId = this.coerceString(
      record.targetId ??
        record.toId ??
        record.toNodeId ??
        (typeof record.target === 'object' && record.target
          ? (record.target as { id?: unknown }).id
          : undefined),
    );
    const direction = this.resolveDirection(sourceId, targetId, nodeId);
    const score =
      this.coerceNumber(record.score) ??
      this.coerceNumber(record.weight) ??
      this.coerceNumber(record.similarity);
    const status = this.coerceString(record.status ?? record.state ?? record.kind);
    const label = this.coerceString(record.label ?? record.name ?? record.description);
    const description = this.coerceString(record.description);
    const toTitle = this.extractTitle(record, 'target') ?? this.extractTitle(record, 'to');
    const fromTitle = this.extractTitle(record, 'source') ?? this.extractTitle(record, 'from');

    return {
      id: this.coerceString(record.id),
      sourceId,
      targetId,
      direction,
      score,
      status,
      label,
      description,
      toTitle,
      fromTitle,
    };
  }

  private extractTitle(record: Record<string, unknown>, key: string): string | undefined {
    const direct = record[`${key}Title`];
    if (typeof direct === 'string' && direct.trim().length > 0) {
      return direct;
    }
    const value = record[key];
    if (value && typeof value === 'object') {
      const title = (value as { title?: unknown }).title;
      if (typeof title === 'string' && title.trim().length > 0) {
        return title;
      }
      const name = (value as { name?: unknown }).name;
      if (typeof name === 'string' && name.trim().length > 0) {
        return name;
      }
    }
    return undefined;
  }

  private coerceString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return undefined;
  }

  private coerceNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return undefined;
  }

  private resolveDirection(
    sourceId: string | undefined,
    targetId: string | undefined,
    nodeId: string,
  ): ForestEdgeRecord['direction'] {
    const normalizedNodeId = nodeId ?? '';
    if (sourceId && sourceId === normalizedNodeId && targetId && targetId === normalizedNodeId) {
      return 'bidirectional';
    }
    if (sourceId && sourceId === normalizedNodeId) {
      return 'out';
    }
    if (targetId && targetId === normalizedNodeId) {
      return 'in';
    }
    return undefined;
  }

  private normalizeBaseUrl(base: string): string {
    try {
      const url = new URL(base);
      url.hash = '';
      url.search = '';
      url.pathname = url.pathname.replace(/\/+$/, '');
      return url.toString();
    } catch {
      return base.replace(/\/+$/, '');
    }
  }

  private normalizeApiPrefix(prefix: string): string {
    if (!prefix) {
      return '';
    }
    const trimmed = prefix.trim();
    if (trimmed === '/' || trimmed === '') {
      return '';
    }
    const leading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    const withoutTrailing = leading.replace(/\/+$/, '');
    return withoutTrailing;
  }

  private buildHttpUrl(path: string): string {
    try {
      const base = new URL(this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
      const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
      const url = new URL(normalizedPath, base);
      return url.toString();
    } catch {
      const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
      const separator = this.baseUrl.endsWith('/') || normalizedPath.length === 0 ? '' : '/';
      return `${this.baseUrl}${separator}${normalizedPath}`;
    }
  }

  private buildApiPath(path: string): string {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }
    const normalized = path.startsWith('/') ? path.slice(1) : path;
    if (!this.apiPrefix) {
      return normalized;
    }
    return `${this.apiPrefix}/${normalized}`.replace(/\/+$/, '');
  }

  private buildWsUrl(path: string): string {
    try {
      const httpUrl = new URL(this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
      const wsUrl = new URL(path, httpUrl);
      wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      return wsUrl.toString();
    } catch {
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      if (this.baseUrl.startsWith('https://')) {
        return `wss://${this.baseUrl.slice('https://'.length)}${normalizedPath}`;
      }
      if (this.baseUrl.startsWith('http://')) {
        return `ws://${this.baseUrl.slice('http://'.length)}${normalizedPath}`;
      }
      return `ws://${this.baseUrl}${normalizedPath}`;
    }
  }

  private decodeMessage(data: WebSocket.RawData): string {
    if (typeof data === 'string') {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data).toString('utf8');
    }
    if (Array.isArray(data)) {
      return Buffer.concat(data).toString('utf8');
    }
    return data.toString('utf8');
  }

  private unwrap<T>(payload: ForestApiEnvelope<T>): T {
    if (payload && typeof payload === 'object' && 'data' in payload) {
      const envelope = payload as { data: T; success?: boolean; error?: unknown; message?: string };
      if (envelope.success === false) {
        const message =
          typeof envelope.error === 'string'
            ? envelope.error
            : envelope.message || 'Forest API responded with an error.';
        throw new Error(message);
      }
      return envelope.data;
    }
    return payload as T;
  }

  private toRecord(input: unknown): Record<string, unknown> | undefined {
    if (input && typeof input === 'object') {
      return input as Record<string, unknown>;
    }
    return undefined;
  }

  private normalizeRecentNodes(section: unknown): ForestStatsRecentNode[] {
    const record = this.toRecord(section);
    if (!record || !Array.isArray(record.recent)) {
      return [];
    }
    return record.recent
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const value = entry as Record<string, unknown>;
        const id = this.coerceString(value.id);
        if (!id) {
          return null;
        }
        return {
          id,
          title: this.coerceString(value.title),
          createdAt: this.coerceString(value.createdAt ?? value.updatedAt),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }

  private normalizeTopTags(section: unknown): ForestStatsTopTag[] {
    const record = this.toRecord(section);
    if (!record) {
      return [];
    }
    const topTags = record.topTags ?? record.tags;
    if (!Array.isArray(topTags)) {
      return [];
    }
    return topTags
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const value = entry as Record<string, unknown>;
        const name = this.coerceString(value.name ?? value.tag);
        if (!name) {
          return null;
        }
        return {
          name,
          count: this.coerceNumber(value.count),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }

  private normalizeTopSuggestions(section: unknown): ForestStatsTopSuggestion[] {
    const record = this.toRecord(section);
    if (!record) {
      return [];
    }
    const topSuggestions = record.topSuggestions ?? record.suggestions;
    if (!Array.isArray(topSuggestions)) {
      return [];
    }
    return topSuggestions
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const value = entry as Record<string, unknown>;
        return {
          ref: this.coerceString(value.ref ?? value.id ?? value.code),
          sourceId: this.coerceString(value.sourceId ?? value.fromId ?? value.sourceNodeId),
          targetId: this.coerceString(value.targetId ?? value.toId ?? value.targetNodeId),
          score: this.coerceNumber(value.score ?? value.weight ?? value.similarity),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }

  private normalizeHighDegreeNodes(input: unknown): ForestStatsHighDegreeNode[] {
    if (!Array.isArray(input)) {
      return [];
    }
    return input
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const value = entry as Record<string, unknown>;
        const id = this.coerceString(value.id);
        if (!id) {
          return null;
        }
        return {
          id,
          title: this.coerceString(value.title),
          edgeCount: this.coerceNumber(value.edgeCount ?? value.degree),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }
}
