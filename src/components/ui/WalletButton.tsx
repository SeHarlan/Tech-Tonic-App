import { useState } from 'react';
import { useConnector, useAccount } from '@solana/connector';
import { MenuButton } from './MenuButton';

const FALLBACK_WALLETS = [
  { name: 'Phantom', url: 'https://phantom.app/' },
  { name: 'Solflare', url: 'https://solflare.com/' },
  { name: 'Backpack', url: 'https://backpack.app/' },
];

export function WalletButton() {
  const [picking, setPicking] = useState(false);
  const { wallets, select, disconnect, connected, connecting } = useConnector();
  const { formatted } = useAccount();

  if (connecting) {
    return <MenuButton disabled>Connecting...</MenuButton>;
  }

  if (connected) {
    return (
      <>
        <MenuButton disabled className="wallet-address">
          {formatted}
        </MenuButton>
        <MenuButton onClick={() => disconnect()}>Disconnect</MenuButton>
      </>
    );
  }

  if (picking) {
    return (
      <div className="wallet-picker-backdrop" onClick={() => setPicking(false)}>
        <div className="wallet-picker" onClick={(e) => e.stopPropagation()}>
          <span className="wallet-picker-scanlines" />
          <div className="wallet-picker-content">
            <h2 className="wallet-picker-title">Connect Wallet</h2>
            <div className="wallet-picker-list">
              {wallets.length > 0
                ? wallets.map((w) => (
                    <MenuButton
                      key={w.wallet.name}
                      onClick={async () => {
                        await select(w.wallet.name);
                        setPicking(false);
                      }}
                    >
                      {w.wallet.name}
                    </MenuButton>
                  ))
                : FALLBACK_WALLETS.map((fw) => (
                    <MenuButton
                      key={fw.name}
                      onClick={() => window.open(fw.url, '_blank')}
                    >
                      Get {fw.name}
                    </MenuButton>
                  ))}
            </div>
            <MenuButton onClick={() => setPicking(false)}>Cancel</MenuButton>
          </div>
        </div>
      </div>
    );
  }

  return <MenuButton onClick={() => setPicking(true)}>ConnectWallet</MenuButton>;
}
