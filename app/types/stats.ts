export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TokenStatsEntry {
  id: string;
  timestamp: number;
  date: string;
  model: string;
  usage: TokenUsage;
  estimatedCost: number;
  requestType: string;
  cached: boolean;
}

export interface AggregatedStats {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  averageInputTokens: number;
  averageOutputTokens: number;
  averageCost: number;
  modelBreakdown: Record<string, {
    count: number;
    tokens: number;
    cost: number;
  }>;
}

export interface TokenStatsData {
  entries: TokenStatsEntry[];
  aggregated: AggregatedStats;
}
