import type { ComponentProps } from 'react';
import DesktopLayoutUnified from '@/components/DesktopLayoutUnified';
import PrivateCallCenter from '@/components/PrivateCallCenterStable';
import { Toaster } from 'sonner';

export default function DesktopLayoutPhase10(props:ComponentProps<typeof DesktopLayoutUnified>){
  return <><Toaster position="top-center" richColors closeButton/><DesktopLayoutUnified {...props}/><PrivateCallCenter/></>;
}
