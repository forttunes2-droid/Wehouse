import { useState } from "react";
import PropertyOwnerDashboard from "@/pages/PropertyOwnerDashboard";
import WorkspaceSwitchSheet from "@/components/WorkspaceSwitchSheet";
import type { Profile } from "@/types";
import type { WorkspaceAccess, WorkspaceChoice } from "@/pages/AccountCenter";

type Props = {
  inboxOpenRequest?: number;
  profile: Profile;
  onLogout: () => void;
  onNavigate: (page: string, id?: string) => void;
  workspaceAccess?: WorkspaceAccess | null;
  activeWorkspace?: WorkspaceChoice;
  onSwitchWorkspace?: (workspace: WorkspaceChoice) => void;
};

export default function HostingDashboard(props: Props) {
  const [switchOpen, setSwitchOpen] = useState(false);
  const canSwitch = Boolean(props.workspaceAccess && props.onSwitchWorkspace);

  return (
    <>
      <PropertyOwnerDashboard
        profile={props.profile}
        inboxOpenRequest={props.inboxOpenRequest}
        onLogout={props.onLogout}
        onNavigate={props.onNavigate}
        delegatedOnly
        onWorkspaceSwitch={canSwitch ? () => setSwitchOpen(true) : undefined}
      />
      {props.workspaceAccess && props.onSwitchWorkspace ? (
        <WorkspaceSwitchSheet
          open={switchOpen}
          access={props.workspaceAccess}
          active={props.activeWorkspace}
          identityName={props.profile.full_name || props.profile.username}
          identityAvatar={props.profile.avatar_url}
          onClose={() => setSwitchOpen(false)}
          onSwitch={props.onSwitchWorkspace}
        />
      ) : null}
    </>
  );
}
