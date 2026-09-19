import { useContext } from 'react';
import { WorkspaceHeadingContext } from '@/lib/workspaceHeading';

export default function WorkspaceSectionHeading({ title, description }: { title: string; description?: string }) {
  const pageTitle = useContext(WorkspaceHeadingContext);
  if (pageTitle.trim().toLowerCase() === title.trim().toLowerCase()) return null;
  return <div>
    <h2 className="text-base font-semibold">{title}</h2>
    {description && <p className="mt-1 max-w-2xl text-sm leading-6 text-[#AAA3B3]">{description}</p>}
  </div>;
}
