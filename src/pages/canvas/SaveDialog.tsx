import { createPortal } from 'react-dom';
import { MenuButton } from '../../components/ui/MenuButton';
import { cn } from '../../utils/ui-helpers';
import { FloppyDiskIcon, ClockCounterClockwiseIcon, ArrowsClockwiseIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';

interface SaveDialogProps {
  open: boolean;
  onClose: () => void;
  onSaveDraft: () => void;
  onLoadDraft: () => void;
  onUpdate: () => void;
  onReset: () => void;
  draftBusy: boolean;
  draftExists: boolean;
  engineReady: boolean;
  canUpdate: boolean;
  updateBusy: boolean;
  updateResult: 'success' | 'error' | null;
  updateError: string | null;
}

export function SaveDialog({
  open,
  onClose,
  onSaveDraft,
  onLoadDraft,
  onUpdate,
  onReset,
  draftBusy,
  draftExists,
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
        className={cn('wallet-picker', 'relative max-h-[80vh] max-w-full min-w-[280px] overflow-x-hidden overflow-y-auto')}
        onClick={(e) => e.stopPropagation()}
      >
        <span className={cn('wallet-picker-scanlines', 'absolute inset-0 overflow-hidden pointer-events-none z-2')} />

        <div className="relative z-1 flex flex-col gap-5 items-center py-9 px-6">
          <h2 className={cn('wallet-picker-title', 'text-[1.1em] tracking-[0.12em] uppercase m-0')}>
            Save / Load
          </h2>

          {/* Draft section */}
          <div className="flex flex-col gap-3 items-center w-full">
            <p className="font-mono text-xs tracking-[0.15em] uppercase text-[rgba(0,255,128,0.7)] m-0">
              Draft
            </p>
            <div className="grid grid-cols-2 gap-4 w-full">
              <div className="flex flex-col items-center gap-2">
                <MenuButton
                  onClick={onSaveDraft}
                  disabled={draftBusy || !engineReady}
                  className="tracking-[0.12em] uppercase gap-2 w-full"
                >
                  <FloppyDiskIcon size={16} weight="bold" className="shrink-0" />
                  Save
                </MenuButton>
                <p className="font-mono text-sm leading-tight tracking-[0.05em] text-[rgba(0,255,128,0.35)] m-0 text-center">
                  Save your edits as a personal draft
                </p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <MenuButton
                  onClick={onLoadDraft}
                  disabled={draftBusy || !engineReady || !draftExists}
                  className="tracking-[0.12em] uppercase gap-2 w-full"
                >
                  <ClockCounterClockwiseIcon size={16} weight="bold" className="shrink-0" />
                  Load
                </MenuButton>
                <p className="font-mono text-sm leading-tight tracking-[0.05em] text-[rgba(0,255,128,0.35)] m-0 text-center">
                  Restore a previously saved draft
                </p>
              </div>
            </div>
          </div>

          {/* Separator */}
          <div className="canvas-overlay-separator" />

          {/* Artifact section */}
          <div className="flex flex-col gap-3 items-center w-full">
            <p className="font-mono text-xs tracking-[0.15em] uppercase text-[rgba(0,255,128,0.7)] m-0">
              Artifact
            </p>
            <div className="grid grid-cols-2 gap-4 w-full">
              <div className="flex flex-col items-center gap-2">
                <MenuButton
                  onClick={onReset}
                  disabled={updateBusy || !engineReady || !canUpdate}
                  className="tracking-[0.12em] uppercase gap-2 w-full"
                >
                  <ArrowCounterClockwiseIcon size={16} weight="bold" className="shrink-0" />
                  Reset
                </MenuButton>
                <p className="font-mono text-sm leading-tight tracking-[0.05em] text-[rgba(0,255,128,0.35)] m-0 text-center">
                  Revert changes made in a draft
                </p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <MenuButton
                  onClick={onUpdate}
                  disabled={updateBusy || !engineReady || !canUpdate}
                  className="tracking-[0.12em] uppercase gap-2 w-full"
                >
                  <ArrowsClockwiseIcon size={16} weight="bold" className={cn("shrink-0", updateBusy && "animate-spin")} />
                  {updateBusy ? 'Updating…' : 'Update'}
                </MenuButton>
                <p className="font-mono text-sm leading-tight tracking-[0.05em] text-[rgba(0,255,128,0.35)] m-0 text-center">
                  Permanently change this artifact for everyone to see
                </p>
              </div>
            </div>
          </div>

          {updateResult === 'success' && (
            <p className="font-mono text-xs tracking-[0.05em] text-[rgb(0,255,128)] m-0 text-center">
              Artifact updated successfully
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
            Cancel
          </MenuButton>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null;
}
