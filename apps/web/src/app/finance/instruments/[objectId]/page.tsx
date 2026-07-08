import { InstrumentDetailClient } from './instrument-detail-client';

export default async function InstrumentDetailPage({ params }: { params: Promise<{ objectId: string }> }) {
  const { objectId } = await params;
  return <InstrumentDetailClient objectId={objectId} />;
}
