import { ObjectWorkspaceDetail } from '../../../../../components/object-workspace';
import { complianceConfig } from '../../../../../lib/workspace-routes';

export default async function ClearanceRequirementPage({ params }: { params: Promise<{ requirementId: string }> }) {
  const { requirementId } = await params;
  return <ObjectWorkspaceDetail objectId={requirementId} config={{ ...complianceConfig, backHref: '/clearance', backLabel: 'Clearance workspace' }} />;
}
