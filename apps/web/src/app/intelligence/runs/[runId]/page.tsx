import { ObjectWorkspaceDetail } from '../../../../components/object-workspace';
import { intelligenceRunsConfig } from '../../../../lib/workspace-routes';

export default async function IntelligenceRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <ObjectWorkspaceDetail objectId={runId} config={{ ...intelligenceRunsConfig, backHref: '/intelligence', backLabel: 'Intelligence workspace' }} />;
}
