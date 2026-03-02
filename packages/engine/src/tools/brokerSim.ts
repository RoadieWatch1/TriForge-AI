import type { ToolDefinition, ToolContext } from '../core/taskTypes';

export const brokerSimDef: ToolDefinition = {
  name: 'broker_sim',
  description: 'Simulate a paper trade order. NO real money involved — for strategy testing only.',
  category: 'trading',
  riskLevel: 'high',
  estimatedCostCents: 0,
  inputSchema: {
    symbol: { type: 'string', description: 'Ticker symbol e.g. AAPL, BTC-USD' },
    side: { type: 'string', description: '"buy" or "sell"' },
    qty: { type: 'number', description: 'Number of shares/units' },
    type: { type: 'string', description: '"market" or "limit"' },
    limitPrice: { type: 'number', description: 'Limit price (required for limit orders)' },
    stopLoss: { type: 'number', description: 'Stop-loss price (required by trust policy for trading)' },
  },
};

interface BrokerSimArgs {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  type: 'market' | 'limit';
  limitPrice?: number;
  stopLoss?: number;
}

interface BrokerSimResult {
  orderId: string;
  symbol: string;
  side: string;
  qty: number;
  simulatedPrice: number;
  status: 'paper';
  filled: boolean;
  stopLoss?: number;
  warning: string;
}

// Simulated prices (static MVP — no live data)
const MOCK_PRICES: Record<string, number> = {
  AAPL: 185.00,
  MSFT: 420.00,
  GOOG: 175.00,
  TSLA: 250.00,
  'BTC-USD': 65000.00,
  'ETH-USD': 3400.00,
};

export async function runBrokerSim(
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<BrokerSimResult> {
  const { symbol, side, qty, type, limitPrice, stopLoss } = args as BrokerSimArgs;

  const basePrice = MOCK_PRICES[symbol?.toUpperCase()] ?? 100.00;
  // Add ±0.5% slippage simulation
  const slippage = (Math.random() - 0.5) * 0.01;
  const simulatedPrice = type === 'limit' && limitPrice ? limitPrice : parseFloat((basePrice * (1 + slippage)).toFixed(2));

  return {
    orderId: `PAPER-${Date.now().toString(36).toUpperCase()}`,
    symbol: (symbol ?? '').toUpperCase(),
    side,
    qty,
    simulatedPrice,
    status: 'paper',
    filled: true,
    stopLoss,
    warning: 'PAPER TRADE ONLY — no real money was used. This is a simulation.',
  };
}
