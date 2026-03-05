import { cn } from '../../utils/ui-helpers';
import './pip-loader.css';

interface PipLoaderProps {
  label?: string;
  className?: string;
}

export function PipLoader({ label = 'INITIALIZING...', className }: PipLoaderProps) {
  return (
    <div
      className={cn(
        'pip-loader',
        'relative flex flex-col items-center justify-center gap-4 p-6 rounded border border-[rgba(0,255,128,0.25)]',
        'bg-[rgba(0,8,4,0.92)] shadow-[0_0_20px_rgba(0,255,128,0.1)]',
        className,
      )}
    >
      {/* Scanline overlay */}
      <span className="pip-loader-scanlines absolute inset-0 pointer-events-none rounded" />

      {/* Label */}
      <p className="pip-loader-label font-mono text-sm tracking-[0.2em] uppercase text-[rgba(0,255,128,0.7)] m-0 relative z-[1]">
        {label}
      </p>

      {/* Loading bar */}
      <div className="relative z-[1] w-48 h-3 border border-[rgba(0,255,128,0.3)] rounded-sm overflow-hidden bg-[rgba(0,255,128,0.05)]">
        <div className="pip-loader-bar-fill h-full bg-[rgba(0,255,128,0.5)]" />
      </div>
    </div>
  );
}
