import { useEffect, useMemo, useRef, useState } from 'react';
import WorkspaceFrameV2 from '@/components/WorkspaceFrameV2';

type Item = { id: string; label: string };
type Props = {
  label: string;
  items: Item[];
  onAccount?: () => void;
  onLogout: () => void;
  children: React.ReactNode;
};

const ACTIVE_MARKERS = ['bg-violet-500', 'bg-indigo-500', 'bg-blue-500', 'bg-cyan-500'];

export default function LegacyWorkspaceBridge({ label, items, onAccount, onLogout, children }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(items[0]?.id || 'overview');
  const sourceRef = useRef<HTMLButtonElement[]>([]);
  const observerRef = useRef<MutationObserver | null>(null);

  const title = useMemo(() => items.find((item) => item.id === active)?.label || label, [active, items, label]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const attach = () => {
      const buttons = Array.from(host.querySelectorAll('header .scrollbar-hide button')).filter(
        (node): node is HTMLButtonElement => node instanceof HTMLButtonElement && Boolean(node.textContent?.trim()),
      );
      if (!buttons.length) return;
      sourceRef.current = buttons;
      observerRef.current?.disconnect();

      const sync = () => {
        const selected = buttons.find((button) => ACTIVE_MARKERS.some((marker) => button.className.includes(marker)));
        const selectedLabel = selected?.textContent?.trim();
        const item = items.find((candidate) => candidate.label === selectedLabel);
        if (item) setActive(item.id);
      };

      sync();
      observerRef.current = new MutationObserver(sync);
      buttons.forEach((button) => observerRef.current?.observe(button, { attributes: true, attributeFilter: ['class'] }));
    };

    attach();
    const structureObserver = new MutationObserver(attach);
    structureObserver.observe(host, { subtree: true, childList: true });

    return () => {
      structureObserver.disconnect();
      observerRef.current?.disconnect();
    };
  }, [items]);

  function open(id: string) {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;
    const source = sourceRef.current.find((button) => button.textContent?.trim() === item.label);
    source?.click();
    setActive(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <WorkspaceFrameV2
      label={label}
      title={title}
      items={items}
      active={active}
      setActive={open}
      onAccount={onAccount}
      onLogout={onLogout}
    >
      <style>{`
        .legacy-workspace-bridge > div {
          min-height: 0 !important;
          padding-bottom: 0 !important;
          background: transparent !important;
        }
        .legacy-workspace-bridge > div > header {
          display: none !important;
        }
        .legacy-workspace-bridge > div > main {
          width: 100% !important;
          max-width: none !important;
          padding: 0 !important;
          margin: 0 !important;
        }
      `}</style>
      <div ref={hostRef} className="legacy-workspace-bridge">
        {children}
      </div>
    </WorkspaceFrameV2>
  );
}
