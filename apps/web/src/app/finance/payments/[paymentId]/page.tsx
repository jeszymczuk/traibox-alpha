import { ObjectWorkspaceDetail } from '../../../../components/object-workspace';
import { paymentsConfig } from '../../../../lib/workspace-routes';

export default async function PaymentDetailPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  return <ObjectWorkspaceDetail objectId={paymentId} config={{ ...paymentsConfig, backHref: '/finance', backLabel: 'Finance workspace' }} />;
}
