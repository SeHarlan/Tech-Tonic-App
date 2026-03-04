import { useMemo } from 'react';
import { AppProvider } from '@solana/connector/react';
import { getDefaultConfig, getDefaultMobileConfig } from '@solana/connector/headless';
import { CLUSTER, RPC_ENDPOINT } from '../config/env';

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const connectorConfig = useMemo(
    () =>
      getDefaultConfig({
        appName: 'Tech Tonic',
        appUrl: typeof window !== 'undefined' ? window.location.origin : '',
        autoConnect: true,
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
        appName: 'Tech Tonic',
        appUrl: typeof window !== 'undefined' ? window.location.origin : '',
      }),
    [],
  );

  return (
    <AppProvider connectorConfig={connectorConfig} mobile={mobile}>
      {children}
    </AppProvider>
  );
}
