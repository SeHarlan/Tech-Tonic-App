import { useAtom } from 'jotai';
import { overlayOpenAtom, overlayTabAtom } from '../store/atoms';
import type { OverlayTab } from '../pages/canvas/OverlayTabs';

export function useOverlay() {
  const [isOverlayOpen, setOpen] = useAtom(overlayOpenAtom);
  const [overlayTab, setTab] = useAtom(overlayTabAtom);

  return {
    isOverlayOpen,
    overlayTab,
    setOverlayTab: setTab,
    openOverlay: (t?: OverlayTab) => {
      setOpen(true);
      if (t) setTab(t);
    },
    closeOverlay: () => {
      setOpen(false);
    },
  };
}
