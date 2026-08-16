import type { ComponentProps } from 'react';
import DesktopLayoutUnified from '@/components/DesktopLayoutUnified';
import PrivateCallCenter from '@/components/PrivateCallCenter';

export default function DesktopLayoutPhase10(props:ComponentProps<typeof DesktopLayoutUnified>){
  return <><DesktopLayoutUnified {...props}/><PrivateCallCenter/></>;
}
