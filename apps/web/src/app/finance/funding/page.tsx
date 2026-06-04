import { ObjectWorkspaceList } from '../../../components/object-workspace';
import { fundingConfig } from '../../../lib/workspace-routes';

export default function FinanceFundingPage() {
  return <ObjectWorkspaceList config={fundingConfig} />;
}
