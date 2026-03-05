import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { OverlayTab } from '../pages/canvas/OverlayTabs';
import type { NftItem } from '../utils/das-api';

// --- Overlay ---
export const overlayOpenAtom = atom(false);
export const overlayTabAtom = atom<OverlayTab>('sketch');

// Last-viewed NFT ID per carousel, persisted to localStorage
export const activeOwnedNftIdAtom = atomWithStorage<string | null>('activeOwnedNftId', null);
export const activeDiscoverNftIdAtom = atomWithStorage<string | null>('activeDiscoverNftId', null);

// --- NFT ---
export const discoverNftsAtom = atom<NftItem[]>([]);
export const ownedNftsAtom = atom<NftItem[]>([]);
export const isLoadingDiscoverAtom = atom(false);
export const isLoadingOwnedAtom = atom(false);

// Holds the refreshOwned function set by useNftEffects
export const refreshOwnedAtom = atom<(() => Promise<NftItem[]>) | null>(null);
