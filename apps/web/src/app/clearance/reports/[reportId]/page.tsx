import { ObjectWorkspaceDetail } from '../../../../components/object-workspace';
import { reportsConfig } from '../../../../lib/workspace-routes';

export default async function ClearanceReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <ObjectWorkspaceDetail objectId={reportId} config={{ ...reportsConfig, backHref: '/clearance', backLabel: 'Clearance workspace' }} />;
}
