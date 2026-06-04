import { ObjectWorkspaceList } from '../../../components/object-workspace';
import { invitationsConfig } from '../../../lib/workspace-routes';

export default function NetworkInvitationsPage() {
  return <ObjectWorkspaceList config={invitationsConfig} />;
}
