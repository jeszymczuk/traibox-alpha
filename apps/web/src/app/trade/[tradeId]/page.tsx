import { redirect } from 'next/navigation';

export default async function TradePage({ params }: { params: Promise<{ tradeId: string }> }) {
  const { tradeId } = await params;
  redirect(`/trades/${tradeId}`);
}
