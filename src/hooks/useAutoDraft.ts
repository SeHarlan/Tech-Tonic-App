import { useEffect, useRef, useState, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { overlayTabAtom, overlayOpenAtom, activeOwnedNftIdAtom, ownedNftsAtom } from '../store/atoms';
import { saveDraft } from '../services/draft-storage';
import type { Engine } from '../engine/renderer';

const AUTO_SAVE_INTERVAL_MS = 60_000;
const INDICATOR_LINGER_MS = 2_000;

export function useAutoDraft(engine: Engine | null) {
  const overlayTab = useAtomValue(overlayTabAtom);
  const overlayOpen = useAtomValue(overlayOpenAtom);
  const activeOwnedId = useAtomValue(activeOwnedNftIdAtom);
  const ownedNfts = useAtomValue(ownedNftsAtom);

  const currentOwnedNft = ownedNfts.find((n) => n.id === activeOwnedId) ?? null;

  const savingRef = useRef(false);
  const lingerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const active = !!(engine && currentOwnedNft && overlayTab === 'owned' && !overlayOpen);

  const saveNow = useCallback(async () => {
    if (!engine || !currentOwnedNft || savingRef.current || overlayTab !== 'owned') return;
    savingRef.current = true;
    clearTimeout(lingerTimer.current);
    setIsSaving(true);
    try {
      const state = await engine.serializeState();
      await saveDraft(currentOwnedNft.id, state, currentOwnedNft.defaultWaterfallMode, engine.isManualMode());
    } catch (err) {
      console.error('[auto-draft] Save failed:', err);
    }
    savingRef.current = false;
    lingerTimer.current = setTimeout(() => setIsSaving(false), INDICATOR_LINGER_MS);
  }, [engine, currentOwnedNft, overlayTab]);

  // Clean up linger timer on unmount
  useEffect(() => () => clearTimeout(lingerTimer.current), []);

  // Interval auto-save while actively drawing on an owned NFT
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => { saveNow(); }, AUTO_SAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active, saveNow]);

  return { isSaving, saveNow };
}
