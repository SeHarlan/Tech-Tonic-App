import { useState, useEffect, useMemo } from 'react';
import { computePhases } from './useActivePhase';
import { cn } from '../../utils/ui-helpers';

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function MintTimeline() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const phases = useMemo(() => computePhases(now), [now]);

  return (
    <div
      className={cn(
        'w-full px-8 py-4',
        'border border-[rgba(0,255,128,0.25)]',
        'bg-[rgba(0,20,10,0.6)]',
        'shadow-[inset_0_0_30px_rgba(0,255,128,0.03),0_0_15px_rgba(0,255,128,0.06)]',
      )}
    >
      <div className="relative">
        {/* Connecting line at dot center height */}
        <div
          className={cn(
            'absolute top-[5px] h-px left-[17%] right-[12%]',
            phases[0]?.status === 'past'
              ? 'bg-[rgba(0,255,128,0.4)]'
              : 'bg-[rgba(0,255,128,0.12)]',
          )}
        />

        {/* Phase columns — dots centered over text */}
        <div className="relative z-10 flex justify-between">
          {phases.map((ps) => (
            <div
              key={ps.phase.group}
              className="flex flex-col items-center gap-1.5"
            >
              {/* Dot */}
              <div
                className={cn(
                  'w-2.5 h-2.5 rounded-full border-2 transition-colors',
                  ps.status === 'active' &&
                    'border-[rgba(0,255,128,0.9)] bg-[rgba(0,255,128,0.7)] shadow-[0_0_8px_rgba(0,255,128,0.6)] animate-pulse',
                  ps.status === 'past' &&
                    'border-[rgba(0,255,128,0.5)] bg-[rgba(0,255,128,0.3)]',
                  ps.status === 'future' &&
                    'border-[rgba(0,255,128,0.2)] bg-transparent',
                  ps.status === 'disabled' &&
                    'border-[rgba(0,255,128,0.12)] bg-transparent',
                )}
              />

              {/* Label */}
              <span
                className={cn(
                  'font-mono text-[10px] uppercase tracking-wider',
                  ps.status === 'active' && 'text-[rgba(0,255,128,0.85)]',
                  ps.status === 'past' && 'text-[rgba(0,255,128,0.4)]',
                  ps.status === 'future' && 'text-[rgba(0,255,128,0.3)]',
                  ps.status === 'disabled' && 'text-[rgba(0,255,128,0.18)]',
                )}
              >
                {ps.phase.label}
              </span>

              {/* Status / countdown */}
              <span
                className={cn(
                  'font-mono text-[9px] tracking-wide',
                  ps.status === 'active'
                    ? 'text-[rgba(0,255,128,0.6)]'
                    : 'text-[rgba(0,255,128,0.25)]',
                )}
              >
                {ps.status === 'disabled' && 'Mainnet Only'}
                {ps.status === 'past' && 'Complete'}
                {ps.status === 'active' &&
                  (ps.endMs
                    ? `Ends in ${formatCountdown(ps.endMs - now)}`
                    : 'Live')}
                {ps.status === 'future' &&
                  `Starts in ${formatCountdown(ps.startMs - now)}`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
