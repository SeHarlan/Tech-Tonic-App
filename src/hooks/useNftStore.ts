import { useAtomValue } from 'jotai';
import {
  discoverNftsAtom,
  ownedNftsAtom,
  isLoadingDiscoverAtom,
  isLoadingOwnedAtom,
} from '../store/atoms';

export function useNftStore() {
  const discoverNfts = useAtomValue(discoverNftsAtom);
  const ownedNfts = useAtomValue(ownedNftsAtom);
  const isLoadingDiscover = useAtomValue(isLoadingDiscoverAtom);
  const isLoadingOwned = useAtomValue(isLoadingOwnedAtom);

  // Only count items the engine can actually load (have a thumbnailUrl).
  // NFTs with broken/missing metadata JSON come back with empty image links
  // and must not light up the Owned/Discover tabs.
  const hasOwned = ownedNfts.some((n) => n.thumbnailUrl);
  const hasDiscover = discoverNfts.some((n) => n.thumbnailUrl);

  return {
    discoverNfts,
    ownedNfts,
    hasOwned,
    hasDiscover,
    isLoadingDiscover,
    isLoadingOwned,
  };
}
