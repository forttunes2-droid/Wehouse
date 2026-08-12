import type { ReactNode } from 'react';

type Item<T extends string> = {
  id: T;
  label: string;
  icon?: ReactNode;
};

type Props<T extends string> = {
  items: Item<T>[];
  active: T;
  onSelect: (id: T) => void;
  accentClass?: string;
};

export default function WorkspaceBottomNav<T extends string>({ items, active, onSelect, accentClass = 'text-blue-400' }: Props<T>) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/[0.08] bg-[#090B12]/96 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <div className="mx-auto flex min-h-16 max-w-lg items-stretch justify-around px-1">
        {items.map(item => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[9px] font-semibold ${selected ? accentClass : 'text-[#6E7282]'}`}
            >
              <span className={`grid h-7 w-7 place-items-center rounded-xl text-base ${selected ? 'bg-white/[0.06]' : ''}`}>{item.icon ?? '•'}</span>
              <span className="max-w-full truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
