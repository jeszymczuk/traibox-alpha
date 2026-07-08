import { TrustPassportClient } from './trust-passport-client';

export default async function CounterpartyDetailPage({ params }: { params: Promise<{ partyId: string }> }) {
  const { partyId } = await params;
  return <TrustPassportClient partyId={partyId} />;
}
