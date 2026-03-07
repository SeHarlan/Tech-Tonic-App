import { createPortal } from 'react-dom';
import { MenuButton } from '../../components/ui/MenuButton';
import { cn } from '../../utils/ui-helpers';
import { FloppyDiskIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';

interface SaveDialogProps {
  open: boolean;
  onClose: () => void;
  onUpdate: () => void;
  onReset: () => void;
  engineReady: boolean;
  canUpdate: boolean;
  updateBusy: boolean;
  updateResult: 'success' | 'error' | null;
  updateError: string | null;
}

export function SaveDialog({
  open,
  onClose,
  onUpdate,
  onReset,
  engineReady,
  canUpdate,
  updateBusy,
  updateResult,
  updateError,
}: SaveDialogProps) {
  if (!open) return null;

  const modal = (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center p-6 bg-black/60 box-border"
      onClick={onClose}
    >
      <div
        className={cn('wallet-picker', 'relative max-h-[80vh] w-[280px] max-w-full overflow-x-hidden overflow-y-auto')}
        onClick={(e) => e.stopPropagation()}
      >
        <span className={cn('wallet-picker-scanlines', 'absolute inset-0 overflow-hidden pointer-events-none z-2')} />

        <div className="relative z-1 flex flex-col gap-5 items-center py-9 px-6">
          <h2 className={cn('wallet-picker-title', 'text-[1.1em] tracking-[0.12em] uppercase m-0')}>
            Artifact
          </h2>

          <div className="flex flex-col gap-4 items-center w-full">
            <div className="flex flex-col items-center gap-1.5 w-full">
              <MenuButton
                onClick={onUpdate}
                disabled={updateBusy || !engineReady || !canUpdate}
                className="tracking-[0.12em] uppercase gap-2 w-full"
              >
                <FloppyDiskIcon size={16} weight="bold" className={cn("shrink-0", updateBusy && "animate-pulse")} />
                <span className={cn(updateBusy && "animate-pulse")}>{updateBusy ? 'Saving…' : 'Save'}</span>
              </MenuButton>
              <p className="font-mono text-[11px] leading-tight tracking-[0.05em] text-[rgba(0,255,128,0.35)] m-0 text-center">
                Permanently edit this artifact for everyone to see
              </p>
            </div>
            <div className="flex flex-col items-center gap-1.5 w-full">
              <MenuButton
                onClick={onReset}
                disabled={updateBusy || !engineReady || !canUpdate}
                className="tracking-[0.12em] uppercase gap-2 w-full"
              >
                <ArrowCounterClockwiseIcon size={16} weight="bold" className="shrink-0" />
                Reset
              </MenuButton>
              <p className="font-mono text-[11px] leading-tight tracking-[0.05em] text-[rgba(0,255,128,0.35)] m-0 text-center">
                Revert the auto saved changes made your draft sessions
              </p>
            </div>
            
          </div>

          {updateResult === 'success' && (
            <p className="font-mono text-xs tracking-[0.05em] text-[rgb(0,255,128)] m-0 text-center">
              Artifact saved successfully
            </p>
          )}
          {updateResult === 'error' && updateError && (
            <p className="font-mono text-xs tracking-[0.05em] text-red-400 m-0 text-center max-w-[260px]">
              {updateError}
            </p>
          )}

          <MenuButton
            onClick={onClose}
            className="shadow-none!"
          >
            Close
          </MenuButton>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null;
}
