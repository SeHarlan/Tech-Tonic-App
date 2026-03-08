import { useEffect, useCallback } from 'react';
import { useSetAtom, useAtom } from 'jotai';
import { useAccount } from '@solana/connector';
import { COLLECTION_ADDRESS } from '../../config/env';
import {
  fetchCollectionAssets,
  fetchOwnedCollectionAssets,
} from '../utils/das-api';
import {
  discoverNftsAtom,
  ownedNftsAtom,
  isLoadingDiscoverAtom,
  isLoadingOwnedAtom,
  refreshOwnedAtom,
} from '../store/atoms';

export function useNftEffects() {
  const { address } = useAccount();

  const [discoverNfts, setDiscoverNfts] = useAtom(discoverNftsAtom);
  const setOwnedNfts = useSetAtom(ownedNftsAtom);
  const setIsLoadingDiscover = useSetAtom(isLoadingDiscoverAtom);
  const setIsLoadingOwned = useSetAtom(isLoadingOwnedAtom);
  const setRefreshOwned = useSetAtom(refreshOwnedAtom);

  // Fetch all collection assets (discover)
  useEffect(() => {
    if (!COLLECTION_ADDRESS) return;
    let cancelled = false;

    setIsLoadingDiscover(true);
    (async () => {
      try {
        const nfts = await fetchCollectionAssets(COLLECTION_ADDRESS);
        if (!cancelled) setDiscoverNfts(nfts);
      } catch (err) {
        console.error('Failed to fetch collection NFTs:', err);
      } finally {
        if (!cancelled) setIsLoadingDiscover(false);
      }
    })();

    return () => { cancelled = true; };
  }, [setDiscoverNfts, setIsLoadingDiscover]);

  // Derive owned NFTs from discover list — avoids a separate RPC call on page load.
  // refreshOwned (below) still does its own searchAssets call for mint polling.
  useEffect(() => {
    if (!address) {
      setOwnedNfts([]);
      return;
    }
    const owned = discoverNfts.filter((n) => n.owner === address);
    setOwnedNfts(owned);
  }, [address, discoverNfts, setOwnedNfts]);

  // refreshOwned — imperatively re-fetches owned NFTs and returns the result
  const refreshOwned = useCallback(async () => {
    if (!address || !COLLECTION_ADDRESS) return [];
    setIsLoadingOwned(true);
    try {
      const nfts = await fetchOwnedCollectionAssets(address, COLLECTION_ADDRESS);
      setOwnedNfts(nfts);
      return nfts;
    } catch (err) {
      console.error('Failed to refresh owned NFTs:', err);
      return [];
    } finally {
      setIsLoadingOwned(false);
    }
  }, [address, setOwnedNfts, setIsLoadingOwned]);

  // Store refreshOwned in atom so MintPage can call it
  useEffect(() => {
    setRefreshOwned(() => refreshOwned);
  }, [refreshOwned, setRefreshOwned]);
}
