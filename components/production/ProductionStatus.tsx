export function ProductionStatus({tone="neutral",children}:{tone?:"success"|"warning"|"danger"|"neutral";children:React.ReactNode}) {
  const styles={success:"bg-emerald-50 text-emerald-800 ring-emerald-700/15",warning:"bg-amber-50 text-amber-800 ring-amber-700/20",danger:"bg-red-50 text-red-800 ring-red-700/15",neutral:"bg-slate-100 text-slate-700 ring-slate-600/15"};
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${styles[tone]}`}>{children}</span>;
}
