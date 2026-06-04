import { ObjectWorkspaceDetail } from '../../../../components/object-workspace';
import { proofConfig } from '../../../../lib/workspace-routes';

export default async function TradeProofPage({ params }: { params: Promise<{ tradeId: string }> }) {
  const { tradeId } = await params;
  return <ObjectWorkspaceDetail objectId={tradeId} tradeIdMode config={{ ...proofConfig, backHref: `/trades/${tradeId}`, backLabel: 'Trade Room' }} />;
}
