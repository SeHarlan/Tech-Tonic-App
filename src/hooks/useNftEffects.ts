import { useEffect, useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { useAccount, useConnector } from '@solana/connector';
import { COLLECTION_ADDRESS } from '../config/env';
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
  const { isConnected } = useConnector();
  const { address } = useAccount();

  const setDiscoverNfts = useSetAtom(discoverNftsAtom);
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

  // Fetch owned assets (wallet-dependent)
  useEffect(() => {
    if (!isConnected || !address || !COLLECTION_ADDRESS) {
      setOwnedNfts([]);
      return;
    }
    let cancelled = false;

    setIsLoadingOwned(true);
    (async () => {
      try {
        const nfts = await fetchOwnedCollectionAssets(address, COLLECTION_ADDRESS);
        if (!cancelled) setOwnedNfts(nfts);
      } catch (err) {
        console.error('Failed to fetch owned NFTs:', err);
      } finally {
        if (!cancelled) setIsLoadingOwned(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isConnected, address, setOwnedNfts, setIsLoadingOwned]);

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
