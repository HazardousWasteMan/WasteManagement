export function StatCard({ label, value, sublabel, valueTitle, valueClassName }: {
  label: string;
  value: string;
  sublabel?: string;
  valueTitle?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-2xl bg-white/80 backdrop-blur border border-black/5 px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-black/50">{label}</p>
      <p className={`font-semibold text-forest ${valueClassName ?? "text-2xl"}`} title={valueTitle}>{value}</p>
      {sublabel && <p className="text-xs text-black/40 mt-1">{sublabel}</p>}
    </div>
  );
}

export function HeroCard({ label, value, sublabel, children }: {
  label: string;
  value: string;
  sublabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-forest text-cream px-6 py-5">
      <p className="text-xs uppercase tracking-wide text-lime/80">{label}</p>
      <p className="text-3xl font-semibold text-lime mt-1">{value}</p>
      {sublabel && <p className="text-sm text-cream/70 mt-1">{sublabel}</p>}
      {children}
    </div>
  );
}

export function ProgressCard({ stageLabel, stageIndex, totalStages, stageNames }: {
  stageLabel: string;
  stageIndex: number; // 0-based
  totalStages: number;
  stageNames: string[];
}) {
  const percent = Math.round(((stageIndex + 1) / totalStages) * 100);
  return (
    <div className="rounded-2xl bg-forest text-cream px-6 py-5">
      <p className="text-xs uppercase tracking-wide text-cream/60">
        Stage {stageIndex + 1} of {totalStages}
      </p>
      <p className="text-lg font-medium mt-1">{stageLabel}</p>
      <div className="mt-3 h-2 rounded-full bg-forest-light overflow-hidden">
        <div
          className="h-full bg-lime rounded-full transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex justify-between mt-2 text-[11px] text-cream/50">
        {stageNames.map((name, i) => {
          const isLast = i === stageNames.length - 1;
          const reached = i <= stageIndex;
          return (
            <span
              key={name}
              className={
                isLast
                  ? "italic opacity-50 underline decoration-dashed"
                  : reached
                    ? "text-lime"
                    : ""
              }
            >
              {name}
            </span>
          );
        })}
      </div>
    </div>
  );
}
