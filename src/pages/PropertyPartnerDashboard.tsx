import { useState } from "react";
import PropertyOwnerDashboard from '@/pages/PropertyOwnerDashboard';
import type { Profile } from '@/types';
import IdentityAccessGate from '@/components/IdentityAccessGate';
import WorkspaceSwitchSheet from '@/components/WorkspaceSwitchSheet';
import type { WorkspaceAccess, WorkspaceChoice } from '@/pages/AccountCenter';

type Props = {
  profile: Profile;
  onLogout: () => void;
  onNavigate: (page: string, id?: string) => void;
  onGoToChat?: (convId?: string) => void;
  workspaceAccess?: WorkspaceAccess | null;
  activeWorkspace?: WorkspaceChoice;
  onSwitchWorkspace?: (workspace: WorkspaceChoice) => void;
};

export default function PropertyPartnerDashboard(props: Props) {
  const [switchOpen, setSwitchOpen] = useState(false);
  const canSwitch = Boolean(props.workspaceAccess && props.onSwitchWorkspace);
  const openSwitch = canSwitch ? () => setSwitchOpen(true) : undefined;

  return (
    <>
      <IdentityAccessGate
        profile={props.profile}
        workspace="property_partner"
        onWorkspaceSwitch={openSwitch}
      >
        <PropertyOwnerDashboard
          {...props}
          onWorkspaceSwitch={openSwitch}
        />
      </IdentityAccessGate>
      {props.workspaceAccess && props.onSwitchWorkspace ? (
        <WorkspaceSwitchSheet
          open={switchOpen}
          access={props.workspaceAccess}
          active={props.activeWorkspace}
          onClose={() => setSwitchOpen(false)}
          onSwitch={props.onSwitchWorkspace}
        />
      ) : null}
    </>
  );
}
