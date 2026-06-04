import { TradePageClient } from '../../trade/[tradeId]/trade-page-client';

export default async function TradesTradeRoomPage({ params }: { params: Promise<{ tradeId: string }> }) {
  const { tradeId } = await params;
  return <TradePageClient tradeId={tradeId} />;
}
