import { ObjectWorkspaceDetail } from '../../../../components/object-workspace';
import { intelligenceSessionsConfig } from '../../../../lib/workspace-routes';

export default async function IntelligenceSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <ObjectWorkspaceDetail objectId={sessionId} config={{ ...intelligenceSessionsConfig, backHref: '/intelligence', backLabel: 'Intelligence workspace' }} />;
}
