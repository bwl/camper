import { describe, expect, it } from 'bun:test';
import { ForestClient } from '../forestClient.js';

function createClient(): ForestClient {
  return new ForestClient({
    baseUrl: 'http://example.com',
    timeoutMs: 5000,
    apiPrefix: '/api/v1',
  });
}

describe('ForestClient.normalizeStats', () => {
  it('normalizes structured stats payload with nested sections', () => {
    const client = createClient();
    const payload = {
      nodes: {
        total: 524,
        recentCount: 3,
        recent: [
          { id: 'n1', title: 'First node', createdAt: '2025-10-18T10:00:00Z' },
          { id: 'n2', title: 'Second node', updatedAt: '2025-10-18T11:00:00Z' },
        ],
      },
      edges: {
        accepted: 1200,
        suggested: 42,
        total: 1242,
      },
      tags: {
        total: 87,
        topTags: [
          { name: 'research', count: 12 },
          { tag: 'ideas', count: 9 },
        ],
      },
      suggestions: {
        highScoreCount: 4,
        topSuggestions: [
          { ref: 'edge-1', sourceId: 'n1', targetId: 'n3', score: 0.82 },
          { code: 'edge-2', fromId: 'n2', toId: 'n4', weight: 0.7 },
        ],
      },
      highDegreeNodes: [
        { id: 'n5', title: 'Hub', edgeCount: 18 },
        { id: 'n6', title: 'Connector', degree: 12 },
      ],
    };

    const result = (client as any).normalizeStats(payload);

    expect(result).toMatchObject({
      nodes: 524,
      edges: 1242,
      suggestedEdges: 42,
      tags: 87,
      recentCount: 3,
      highScoreSuggestionCount: 4,
      recentNodes: [
        { id: 'n1', title: 'First node', createdAt: '2025-10-18T10:00:00Z' },
        { id: 'n2', title: 'Second node', createdAt: '2025-10-18T11:00:00Z' },
      ],
      topTags: [
        { name: 'research', count: 12 },
        { name: 'ideas', count: 9 },
      ],
      topSuggestions: [
        { ref: 'edge-1', sourceId: 'n1', targetId: 'n3', score: 0.82 },
        { ref: 'edge-2', sourceId: 'n2', targetId: 'n4', score: 0.7 },
      ],
      highDegreeNodes: [
        { id: 'n5', title: 'Hub', edgeCount: 18 },
        { id: 'n6', title: 'Connector', edgeCount: 12 },
      ],
    });
  });

  it('falls back to flat counts when sections are missing', () => {
    const client = createClient();
    const payload = {
      nodes: 10,
      edges: 20,
      suggestedEdges: 2,
      tags: 5,
    };

    const result = (client as any).normalizeStats(payload);

    expect(result).toEqual({
      nodes: 10,
      edges: 20,
      suggestedEdges: 2,
      tags: 5,
      recentCount: undefined,
      highScoreSuggestionCount: undefined,
      recentNodes: [],
      topTags: [],
      topSuggestions: [],
      highDegreeNodes: [],
    });
  });
});
