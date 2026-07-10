'use client';

import { useState, useEffect, useCallback } from 'react';
import { TokenStatsData, TokenStatsEntry, AggregatedStats } from '../types/stats';

const STORAGE_KEY = 'token_stats_data';

// Approximate pricing per 1M tokens (as of 2024)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
  'claude-3-opus-20240229': { input: 15, output: 75 },
  'claude-3-sonnet-20240229': { input: 3, output: 15 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};

export function useTokenStats() {
  const [stats, setStats] = useState<TokenStatsData | null>(null);
  const [loading, setLoading] = useState(true);

  // Load stats from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setStats(parsed);
      }
    } catch (error) {
      console.error('Failed to load token stats:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Save stats to localStorage whenever they change
  useEffect(() => {
    if (stats) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
      } catch (error) {
        console.error('Failed to save token stats:', error);
      }
    }
  }, [stats]);

  // Calculate estimated cost
  const calculateCost = useCallback((model: string, inputTokens: number, outputTokens: number): number => {
    const pricing = PRICING[model] || PRICING['claude-3-5-sonnet-20241022'];
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }, []);

  // Aggregate stats
  const aggregateStats = useCallback((entries: TokenStatsEntry[]): AggregatedStats => {
    const aggregated: AggregatedStats = {
      totalRequests: entries.length,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      averageInputTokens: 0,
      averageOutputTokens: 0,
      averageCost: 0,
      modelBreakdown: {},
    };

    if (entries.length === 0) return aggregated;

    entries.forEach(entry => {
      aggregated.totalInputTokens += entry.usage.inputTokens;
      aggregated.totalOutputTokens += entry.usage.outputTokens;
      aggregated.totalTokens += entry.usage.totalTokens;
      aggregated.totalCost += entry.estimatedCost;

      // Model breakdown
      if (!aggregated.modelBreakdown[entry.model]) {
        aggregated.modelBreakdown[entry.model] = {
          count: 0,
          tokens: 0,
          cost: 0,
        };
      }
      aggregated.modelBreakdown[entry.model].count++;
      aggregated.modelBreakdown[entry.model].tokens += entry.usage.totalTokens;
      aggregated.modelBreakdown[entry.model].cost += entry.estimatedCost;
    });

    aggregated.averageInputTokens = aggregated.totalInputTokens / entries.length;
    aggregated.averageOutputTokens = aggregated.totalOutputTokens / entries.length;
    aggregated.averageCost = aggregated.totalCost / entries.length;

    return aggregated;
  }, []);

  // Add new token usage entry
  const addTokenUsage = useCallback((
    model: string,
    inputTokens: number,
    outputTokens: number,
    requestType: string = 'unknown',
    cached: boolean = false
  ) => {
    const totalTokens = inputTokens + outputTokens;
    const estimatedCost = calculateCost(model, inputTokens, outputTokens);
    const now = new Date();
    const entry: TokenStatsEntry = {
      id: `${now.getTime()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: now.getTime(),
      date: now.toISOString(),
      model,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
      },
      estimatedCost,
      requestType,
      cached,
    };

    setStats(prev => {
      if (!prev) {
        return {
          entries: [entry],
          aggregated: aggregateStats([entry]),
        };
      }

      const newEntries = [...prev.entries, entry];
      return {
        entries: newEntries,
        aggregated: aggregateStats(newEntries),
      };
    });
  }, [calculateCost, aggregateStats]);

  // Clear all stats
  const clearStats = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setStats({
        entries: [],
        aggregated: {
          totalRequests: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalCost: 0,
          averageInputTokens: 0,
          averageOutputTokens: 0,
          averageCost: 0,
          modelBreakdown: {},
        },
      });
    } catch (error) {
      console.error('Failed to clear token stats:', error);
    }
  }, []);

  // Get stats for last N days
  const getStatsForPeriod = useCallback((days: number): TokenStatsData | null => {
    if (!stats) return null;

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const filteredEntries = stats.entries.filter(entry => entry.timestamp >= cutoff);

    return {
      entries: filteredEntries,
      aggregated: aggregateStats(filteredEntries),
    };
  }, [stats, aggregateStats]);

  return {
    stats,
    loading,
    addTokenUsage,
    clearStats,
    getStatsForPeriod,
  };
}
