import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useConnector, useAccount } from '@solana/connector';
import { MenuButton } from './MenuButton';
import { cn } from '../../utils/ui-helpers';
import '../../pages/canvas/canvas-overlay.css';

const FALLBACK_WALLETS = [
  { name: 'Phantom', url: 'https://phantom.app/' },
  { name: 'Solflare', url: 'https://solflare.com/' },
  { name: 'Backpack', url: 'https://backpack.app/' },
];

export function WalletButton() {
  const [picking, setPicking] = useState(false);
  const { connectors, connectWallet, disconnectWallet, isConnected, isConnecting } =
    useConnector();
  const { formatted } = useAccount();

  if (isConnecting) {
    return <MenuButton disabled>Connecting...</MenuButton>;
  }

  if (isConnected) {
    return (
      <MenuButton
        onClick={() => disconnectWallet()}
        className="wallet-address shadow-none!"
      >
        {formatted}
      </MenuButton>
    );
  }

  const modal = picking && (
    <div className="fixed inset-0 z-200 flex items-center justify-center p-6 bg-black/60 box-border" onClick={() => setPicking(false)}>
      <div className={cn('wallet-picker', 'relative max-h-[80vh] max-w-full min-w-[280px] overflow-x-hidden overflow-y-auto')} onClick={(e) => e.stopPropagation()}>
        <span className={cn('wallet-picker-scanlines', 'absolute inset-0 overflow-hidden pointer-events-none z-2')} />
        <div className="relative z-1 flex flex-col gap-5 items-center py-9 px-4">
          <h2 className={cn('wallet-picker-title', 'text-[1.1em] tracking-[0.12em] uppercase m-0')}>Connect Wallet</h2>
          <div className="flex flex-col gap-4 items-stretch w-full py-5 px-10">
            {connectors.length > 0
              ? connectors.map((c) => (
                  <MenuButton
                    key={c.id}
                    className="w-full box-border block! truncate"
                    onClick={async () => {
                      await connectWallet(c.id);
                      setPicking(false);
                    }}
                  >
                    {c.name}
                  </MenuButton>
                ))
              : FALLBACK_WALLETS.map((fw) => (
                  <MenuButton
                    key={fw.name}
                    className="w-full box-border"
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

  return (
    <>
      {typeof document !== 'undefined' && createPortal(modal, document.body)}
      <MenuButton disabled={picking} onClick={() => setPicking(true)}>Connect Wallet</MenuButton>
    </>
  )
}
