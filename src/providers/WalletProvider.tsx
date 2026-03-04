import { useEffect, useMemo, useRef } from 'react';
import {
  AppProvider,
  useConnectWallet,
  useWalletConnectors,
  useWallet,
} from '@solana/connector/react';
import { getDefaultConfig, getDefaultMobileConfig } from '@solana/connector/headless';
import { CLUSTER, RPC_ENDPOINT } from '../config/env';
import { APP_NAME } from '../utils/contants';

const WALLET_STORAGE_KEY = 'connector-kit:v1:wallet';

/**
 * The library's built-in autoConnect uses a legacy connect path that calls
 * connect({ silent: false }), which can hang waiting for user interaction.
 * This hook uses the vNext connectWallet path with silent-first + timeout.
 */
function AutoConnect() {
  const { connect } = useConnectWallet();
  const connectors = useWalletConnectors();
  const { isConnected } = useWallet();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current || isConnected || connectors.length === 0) return;
    attempted.current = true;

    const stored = localStorage.getItem(WALLET_STORAGE_KEY);
    if (!stored) return;

    let walletName: string;
    try {
      walletName = JSON.parse(stored);
    } catch {
      return;
    }
    if (!walletName) return;

    const match = connectors.find(
      (c) => c.name.toLowerCase() === walletName.toLowerCase(),
    );
    if (!match) return;

    connect(match.id, { silent: true, allowInteractiveFallback: false }).catch(
      () => {},
    );
  }, [connectors, isConnected, connect]);

  return null;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const connectorConfig = useMemo(
    () =>
      getDefaultConfig({
        appName: APP_NAME,
        appUrl: typeof window !== 'undefined' ? window.location.origin : '',
        autoConnect: false,
        debug: import.meta.env.DEV,
        enableMobile: true,
        clusters: [
          {
            id: `solana:${CLUSTER}`,
            label: CLUSTER,
            url: RPC_ENDPOINT,
          },
        ],
      }),
    [],
  );

  const mobile = useMemo(
    () =>
      getDefaultMobileConfig({
        appName: APP_NAME,
        appUrl: typeof window !== 'undefined' ? window.location.origin : '',
      }),
    [],
  );

  return (
    <AppProvider connectorConfig={connectorConfig} mobile={mobile}>
      <AutoConnect />
      {children}
    </AppProvider>
  );
}
