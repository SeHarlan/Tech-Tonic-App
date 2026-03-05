import { cn } from '../../utils/ui-helpers';

export type OverlayTab = 'sketch' | 'owned' | 'discover';

interface OverlayTabsProps {
  activeTab: OverlayTab;
  onTabChange: (tab: OverlayTab) => void;
  ownedDisabled: boolean;
}

const TABS: OverlayTab[] = ['owned', 'sketch', 'discover'];

const TAB_LABEL: Record<OverlayTab, string> = {
  owned: 'Owned',
  sketch: 'Sketch Pad',
  discover: 'Discover',
};

export function OverlayTabs({ activeTab, onTabChange, ownedDisabled }: OverlayTabsProps) {
  return (
    <div className="flex items-center justify-center gap-4 font-mono text-xs tracking-[0.15em] uppercase">
      {TABS.map((tab) => {
        const isActive = tab === activeTab;
        const isDisabled = tab === 'owned' && ownedDisabled;
        return (
          <button
            key={tab}
            type="button"
            disabled={isDisabled}
            onClick={() => onTabChange(tab)}
            title={isDisabled ? "No artifacts found in wallet" : undefined}
            className={cn(
              'overlay-tab-btn bg-transparent border-none whitespace-nowrap px-0.5 py-0',
              isDisabled
                ? 'text-[rgba(0,255,128,0.15)] cursor-default'
                : isActive
                  ? 'text-[rgb(0,255,128)] cursor-pointer'
                  : 'text-[rgba(0,255,128,0.35)] hover:text-[rgba(0,255,128,0.55)] cursor-pointer',
            )}
          >
            {isActive && !isDisabled ? `[ ${TAB_LABEL[tab]} ]` : TAB_LABEL[tab]}
          </button>
        );
      })}
    </div>
  );
}
