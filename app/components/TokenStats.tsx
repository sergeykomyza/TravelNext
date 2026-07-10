'use client';

import React, { useState, useMemo } from 'react';
import { useTokenStatsContext } from '../context/TokenStatsContext';

interface MiniChartProps {
  data: number[];
  color?: string;
  height?: number;
}

function MiniChart({ data, color = '#3b82f6', height = 40 }: MiniChartProps) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1 || 1)) * 100;
    const y = 100 - ((value - min) / range) * 100;
    return `${x},${y}`;
  }).join(' ');

  if (data.length < 2) {
    return <div className="h-full w-full bg-gray-200 dark:bg-gray-700 rounded" />;
  }

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="h-full w-full"
      style={{ height: `${height}px` }}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

interface BarChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
}

function BarChart({ data, height = 120 }: BarChartProps) {
  const maxValue = Math.max(...data.map(d => d.value), 1);

  return (
    <div className="space-y-2" style={{ height: `${height}px` }}>
      {data.map((item, index) => {
        const percentage = (item.value / maxValue) * 100;
        return (
          <div key={index} className="flex items-center gap-2 text-xs">
            <div className="w-24 flex-shrink-0 truncate text-right" title={item.label}>
              {item.label}
            </div>
            <div className="flex-1 h-4 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
              <div
                className="h-full transition-all duration-300"
                style={{
                  width: `${percentage}%`,
                  backgroundColor: item.color || '#3b82f6',
                }}
              />
            </div>
            <div className="w-16 flex-shrink-0 text-right font-mono">
              {item.value.toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  color?: string;
}

function StatCard({ title, value, subtitle, color = '#3b82f6' }: StatCardProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
        {title}
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white" style={{ color }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {subtitle && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {subtitle}
        </div>
      )}
    </div>
  );
}

export function TokenStats() {
  const { stats, loading, clearStats, getStatsForPeriod } = useTokenStatsContext();
  const [isOpen, setIsOpen] = useState(false);
  const [period, setPeriod] = useState<'all' | 'today' | 'week' | 'month'>('all');

  const handleClear = () => {
    if (confirm('Are you sure you want to clear all token statistics?')) {
      clearStats();
    }
  };

  const getFilteredStats = () => {
    if (period === 'all') return stats;
    if (period === 'today') return getStatsForPeriod(1);
    if (period === 'week') return getStatsForPeriod(7);
    if (period === 'month') return getStatsForPeriod(30);
    return stats;
  };

  const filteredStats = getFilteredStats();
  const { entries, aggregated } = filteredStats || { entries: [], aggregated: null };

  // Prepare chart data
  const tokenHistory = useMemo(() => {
    return entries.slice(-20).map(entry => entry.usage.totalTokens);
  }, [entries]);

  const costHistory = useMemo(() => {
    return entries.slice(-20).map(entry => entry.estimatedCost * 1000); // Scale up for visibility
  }, [entries]);

  const modelBreakdown = useMemo(() => {
    if (!aggregated?.modelBreakdown) return [];
    return Object.entries(aggregated.modelBreakdown)
      .map(([model, data]) => ({
        label: model.replace('claude-', '').replace('-20241022', '').replace('-20240229', ''),
        value: data.tokens,
        color: model.includes('opus') ? '#f59e0b' : model.includes('haiku') ? '#10b981' : '#3b82f6',
      }))
      .sort((a, b) => b.value - a.value);
  }, [aggregated]);

  const requestTypeBreakdown = useMemo(() => {
    const types: Record<string, number> = {};
    entries.forEach(entry => {
      types[entry.requestType] = (types[entry.requestType] || 0) + 1;
    });
    return Object.entries(types)
      .map(([type, count]) => ({ label: type, value: count }))
      .sort((a, b) => b.value - a.value);
  }, [entries]);

  if (loading) {
    return null;
  }

  const totalCost = aggregated?.totalCost || 0;
  const totalTokens = aggregated?.totalTokens || 0;

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 right-4 z-50 bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded-lg shadow-lg transition-all duration-200 text-sm font-medium flex items-center gap-2"
        title="Toggle Token Statistics"
      >
        <span className="text-lg">📊</span>
        <span className="hidden sm:inline">${totalCost.toFixed(4)}</span>
        <span className="text-xs text-blue-200">({totalTokens.toLocaleString()} tok)</span>
      </button>

      {/* Full stats panel */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Token Usage Statistics
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Track your Claude API usage and costs
                </p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Period selector */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-gray-500 dark:text-gray-400">Period:</span>
                {(['all', 'today', 'week', 'month'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-3 py-1 rounded text-sm transition-colors ${
                      period === p
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>

              {/* Main stats cards */}
              {aggregated && aggregated.totalRequests > 0 ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard
                      title="Total Requests"
                      value={aggregated.totalRequests}
                      subtitle={`${entries.length} entries`}
                      color="#8b5cf6"
                    />
                    <StatCard
                      title="Total Tokens"
                      value={aggregated.totalTokens.toLocaleString()}
                      subtitle={`${aggregated.totalInputTokens.toLocaleString()} in / ${aggregated.totalOutputTokens.toLocaleString()} out`}
                      color="#3b82f6"
                    />
                    <StatCard
                      title="Total Cost"
                      value={`$${aggregated.totalCost.toFixed(4)}`}
                      subtitle="Estimated USD"
                      color="#10b981"
                    />
                    <StatCard
                      title="Avg Cost/Request"
                      value={`$${aggregated.averageCost.toFixed(6)}`}
                      subtitle={`${Math.round(aggregated.averageInputTokens + aggregated.averageOutputTokens)} avg tokens`}
                      color="#f59e0b"
                    />
                  </div>

                  {/* Charts */}
                  {tokenHistory.length > 0 && (
                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                          Token Usage (Last {tokenHistory.length} requests)
                        </h3>
                        <MiniChart data={tokenHistory} color="#3b82f6" />
                        <div className="flex justify-between text-xs text-gray-500 mt-2">
                          <span>Min: {Math.min(...tokenHistory).toLocaleString()}</span>
                          <span>Max: {Math.max(...tokenHistory).toLocaleString()}</span>
                        </div>
                      </div>

                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                          Cost History (Last {costHistory.length} requests) ×1000
                        </h3>
                        <MiniChart data={costHistory} color="#10b981" />
                        <div className="flex justify-between text-xs text-gray-500 mt-2">
                          <span>${(Math.min(...costHistory) / 1000).toFixed(6)}</span>
                          <span>${(Math.max(...costHistory) / 1000).toFixed(6)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Model breakdown */}
                  {modelBreakdown.length > 0 && (
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                        Tokens by Model
                      </h3>
                      <BarChart data={modelBreakdown} />
                    </div>
                  )}

                  {/* Request type breakdown */}
                  {requestTypeBreakdown.length > 0 && (
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                        Requests by Type
                      </h3>
                      <BarChart data={requestTypeBreakdown.map(item => ({ ...item, color: '#8b5cf6' }))} />
                    </div>
                  )}

                  {/* Recent entries */}
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                      Recent Requests
                    </h3>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {entries.slice().reverse().slice(0, 10).map((entry) => (
                        <div
                          key={entry.id}
                          className="bg-white dark:bg-gray-800 rounded p-3 text-xs border border-gray-200 dark:border-gray-700"
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div className="font-mono text-gray-600 dark:text-gray-400">
                              {new Date(entry.timestamp).toLocaleString()}
                            </div>
                            <div className="font-semibold text-blue-600 dark:text-blue-400">
                              ${entry.estimatedCost.toFixed(6)}
                            </div>
                          </div>
                          <div className="flex justify-between text-gray-500 dark:text-gray-400">
                            <span>{entry.model}</span>
                            <span>{entry.usage.totalTokens.toLocaleString()} tokens</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">📊</div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    No token usage data yet
                  </h3>
                  <p className="text-gray-500 dark:text-gray-400">
                    Start generating travel plans to see your token statistics here.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            {aggregated && aggregated.totalRequests > 0 && (
              <div className="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Data stored locally in your browser
                </div>
                <button
                  onClick={handleClear}
                  className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg transition-colors"
                >
                  Clear Statistics
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
