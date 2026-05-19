import { TradePageClient } from './trade-page-client';

export default async function TradePage({ params }: { params: Promise<{ tradeId: string }> }) {
  const { tradeId } = await params;
  return <TradePageClient tradeId={tradeId} />;
}
