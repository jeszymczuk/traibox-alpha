import { ObjectWorkspaceDetail } from '../../../../components/object-workspace';
import { passportConfig } from '../../../../lib/workspace-routes';

export default async function TradePassportPage({ params }: { params: Promise<{ passportId: string }> }) {
  const { passportId } = await params;
  return <ObjectWorkspaceDetail objectId={passportId} config={{ ...passportConfig, backHref: '/clearance', backLabel: 'Clearance workspace' }} />;
}
