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

  return {
    discoverNfts,
    ownedNfts,
    hasOwned: ownedNfts.length > 0,
    isLoadingDiscover,
    isLoadingOwned,
  };
}
