import { PaymentDetailClient } from './payment-detail-client';

// Renders the v9 payment detail for rail payments; the client falls back to
// ObjectWorkspaceDetail when the id belongs to a payment_intent alpha object.
export default async function PaymentDetailPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  return <PaymentDetailClient paymentId={paymentId} />;
}
