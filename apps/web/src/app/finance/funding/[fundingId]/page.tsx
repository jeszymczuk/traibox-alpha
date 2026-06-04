import { ObjectWorkspaceDetail } from '../../../../components/object-workspace';
import { fundingConfig } from '../../../../lib/workspace-routes';

export default async function FundingDetailPage({ params }: { params: Promise<{ fundingId: string }> }) {
  const { fundingId } = await params;
  return <ObjectWorkspaceDetail objectId={fundingId} config={{ ...fundingConfig, backHref: '/finance/funding', backLabel: 'Funding queue' }} />;
}
