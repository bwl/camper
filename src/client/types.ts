export interface ForestHealthResponse {
  ok: boolean;
  status?: string;
  version?: string;
  databasePath?: string;
  message?: string;
  uptimeSeconds?: number;
}

export interface ForestStatsRecentNode {
  id: string;
  title?: string;
  createdAt?: string;
}

export interface ForestStatsTopTag {
  name: string;
  count?: number;
}

export interface ForestStatsTopSuggestion {
  ref?: string;
  sourceId?: string;
  targetId?: string;
  score?: number;
}

export interface ForestStatsHighDegreeNode {
  id: string;
  title?: string;
  edgeCount?: number;
}

export interface ForestStatsResponse {
  nodes?: number;
  edges?: number;
  suggestedEdges?: number;
  tags?: number;
  recentCount?: number;
  highScoreSuggestionCount?: number;
  recentNodes?: ForestStatsRecentNode[];
  topTags?: ForestStatsTopTag[];
  topSuggestions?: ForestStatsTopSuggestion[];
  highDegreeNodes?: ForestStatsHighDegreeNode[];
}

export type ForestApiEnvelope<T> =
  | T
  | {
      success?: boolean;
      data: T;
      message?: string;
      error?: unknown;
    };

export interface ForestNodeListItem {
  id: string;
  shortId?: string;
  title: string;
  tags: string[];
  bodyPreview?: string;
  bodyLength?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ForestNodeListResponse {
  items: ForestNodeListItem[];
  total?: number;
  limit?: number;
  offset?: number;
}

export interface ForestNodeContent {
  id: string;
  shortId?: string;
  title: string;
  body: string;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
  bodyLength?: number;
}

export interface ForestEdgeRecord {
  id?: string;
  sourceId?: string;
  targetId?: string;
  direction?: 'in' | 'out' | 'bidirectional';
  score?: number;
  status?: string;
  label?: string;
  description?: string;
  toTitle?: string;
  fromTitle?: string;
  [key: string]: unknown;
}

export interface ForestNodeDetail {
  id: string;
  title?: string;
  body?: string;
  tags: string[];
  bodyLength?: number;
  edges?: ForestEdgeRecord[];
  edgesTotal?: number;
  suggestions?: ForestEdgeRecord[];
  suggestionsTotal?: number;
}

export interface ForestTagListItem {
  name: string;
  count?: number;
}

export interface ForestTagListResponse {
  items: ForestTagListItem[];
  total?: number;
  limit?: number;
  offset?: number;
}

export interface ForestClientOptions {
  baseUrl: string;
  timeoutMs: number;
  apiPrefix: string;
}

export interface NodeContentRequestOptions {
  forceRefresh?: boolean;
}

export interface ListNodesParams {
  limit?: number;
  offset?: number;
  tags?: string[];
  search?: string;
}

export interface ListTagsParams {
  limit?: number;
  offset?: number;
  search?: string;
  includeCounts?: boolean;
}

export interface NodeDetailRequestOptions {
  includeBody?: boolean;
  includeEdges?: boolean;
  includeSuggestions?: boolean;
  edgesLimit?: number;
  suggestionsLimit?: number;
  forceRefresh?: boolean;
}

export type ForestEvent =
  | { type: 'node:created'; node: ForestNodeContent }
  | { type: 'node:updated'; node: ForestNodeContent }
  | { type: 'node:deleted'; nodeId: string }
  | { type: 'edge:created'; edge: Record<string, unknown> }
  | { type: 'edge:accepted'; edge: Record<string, unknown> }
  | { type: 'edge:rejected'; edge: Record<string, unknown> }
  | { type: 'edge:deleted'; edgeId: string }
  | { type: 'tag:renamed'; old: string; new: string }
  | { type: string; [key: string]: unknown };

export type EventStreamStatus = 'connecting' | 'connected' | 'disconnected';

export interface EventStreamOptions {
  path?: string;
  protocols?: string | string[];
  retryDelayMs?: number;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: EventStreamStatus) => void;
}
