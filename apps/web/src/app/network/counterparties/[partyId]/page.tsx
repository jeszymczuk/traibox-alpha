import { ObjectWorkspaceDetail } from '../../../../components/object-workspace';
import { counterpartiesConfig } from '../../../../lib/workspace-routes';

export default async function CounterpartyDetailPage({ params }: { params: Promise<{ partyId: string }> }) {
  const { partyId } = await params;
  return <ObjectWorkspaceDetail objectId={partyId} config={{ ...counterpartiesConfig, backHref: '/network', backLabel: 'Network workspace' }} />;
}
