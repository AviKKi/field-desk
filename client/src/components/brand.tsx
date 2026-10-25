import { Workflow } from 'lucide-react';
export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`grid size-9 place-items-center rounded-xl ${light ? 'bg-white/12 text-emerald-200' : 'bg-primary text-primary-foreground'}`}
      >
        <Workflow className="size-5" />
      </span>
      <span className="text-lg font-semibold tracking-tight">
        rule
        <span className={light ? 'text-emerald-200' : 'text-primary'}>
          engine
        </span>
        <span className="ml-1.5 align-top text-[9px] font-medium uppercase tracking-widest opacity-50">
          Workspace
        </span>
      </span>
    </div>
  );
}
