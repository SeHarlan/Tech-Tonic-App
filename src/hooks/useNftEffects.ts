import { useEffect, useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { useAccount, useConnector } from '@solana/connector';
import { publicKey } from '@metaplex-foundation/umi';
import { fetchCandyMachine } from '@metaplex-foundation/mpl-core-candy-machine';
import { useUmi } from './useUmi';
import { CANDY_MACHINE_ADDRESS } from '../config/env';
import {
  fetchCollectionAssets,
  fetchOwnedCollectionAssets,
} from '../utils/das-api';
import {
  collectionAddressAtom,
  discoverNftsAtom,
  ownedNftsAtom,
  isLoadingDiscoverAtom,
  isLoadingOwnedAtom,
  refreshOwnedAtom,
} from '../store/atoms';
import { useAtomValue } from 'jotai';

export function useNftEffects() {
  const umi = useUmi();
  const { isConnected } = useConnector();
  const { address } = useAccount();

  const collectionAddress = useAtomValue(collectionAddressAtom);
  const setCollectionAddress = useSetAtom(collectionAddressAtom);
  const setDiscoverNfts = useSetAtom(discoverNftsAtom);
  const setOwnedNfts = useSetAtom(ownedNftsAtom);
  const setIsLoadingDiscover = useSetAtom(isLoadingDiscoverAtom);
  const setIsLoadingOwned = useSetAtom(isLoadingOwnedAtom);
  const setRefreshOwned = useSetAtom(refreshOwnedAtom);

  // Resolve collection address from candy machine (once)
  useEffect(() => {
    if (!CANDY_MACHINE_ADDRESS || collectionAddress) return;
    let cancelled = false;

    (async () => {
      try {
        const cm = await fetchCandyMachine(umi, publicKey(CANDY_MACHINE_ADDRESS));
        if (!cancelled) setCollectionAddress(cm.collectionMint as string);
      } catch (err) {
        console.error('Failed to fetch candy machine:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [umi, collectionAddress, setCollectionAddress]);

  // Fetch all collection assets (discover)
  useEffect(() => {
    if (!collectionAddress) return;
    let cancelled = false;

    setIsLoadingDiscover(true);
    (async () => {
      try {
        const nfts = await fetchCollectionAssets(collectionAddress);
        if (!cancelled) setDiscoverNfts(nfts);
      } catch (err) {
        console.error('Failed to fetch collection NFTs:', err);
      } finally {
        if (!cancelled) setIsLoadingDiscover(false);
      }
    })();

    return () => { cancelled = true; };
  }, [collectionAddress, setDiscoverNfts, setIsLoadingDiscover]);

  // Fetch owned assets (wallet-dependent)
  useEffect(() => {
    if (!isConnected || !address || !collectionAddress) {
      setOwnedNfts([]);
      return;
    }
    let cancelled = false;

    setIsLoadingOwned(true);
    (async () => {
      try {
        const nfts = await fetchOwnedCollectionAssets(address, collectionAddress);
        if (!cancelled) setOwnedNfts(nfts);
      } catch (err) {
        console.error('Failed to fetch owned NFTs:', err);
      } finally {
        if (!cancelled) setIsLoadingOwned(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isConnected, address, collectionAddress, setOwnedNfts, setIsLoadingOwned]);

  // refreshOwned — imperatively re-fetches owned NFTs and returns the result
  const refreshOwned = useCallback(async () => {
    if (!address || !collectionAddress) return [];
    setIsLoadingOwned(true);
    try {
      const nfts = await fetchOwnedCollectionAssets(address, collectionAddress);
      setOwnedNfts(nfts);
      return nfts;
    } catch (err) {
      console.error('Failed to refresh owned NFTs:', err);
      return [];
    } finally {
      setIsLoadingOwned(false);
    }
  }, [address, collectionAddress, setOwnedNfts, setIsLoadingOwned]);

  // Store refreshOwned in atom so MintPage can call it
  useEffect(() => {
    setRefreshOwned(() => refreshOwned);
  }, [refreshOwned, setRefreshOwned]);
}
