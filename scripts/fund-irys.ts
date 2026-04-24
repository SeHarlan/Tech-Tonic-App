/**
 * Fund the deployer keypair's Irys L1 balance.
 *
 * Irys L1 requires a pre-funded balance before uploads can run. Balance is
 * keyed to (wallet address, network) and persists on Irys's books across
 * SDK restarts. One funding covers both mint-time uploads and post-mint
 * update uploads.
 *
 * Irys L1 has no testnet — uploads always go to L1 mainnet (uploader.irys.xyz).
 * Funding requires real mainnet SOL. Upload costs are trivial (fractions
 * of a cent per NFT-sized payload). The same balance serves devnet-minted
 * and mainnet-minted NFTs since Irys URIs are uniform across Solana clusters.
 *
 * Usage:
 *   bun run scripts/fund-irys.ts                        # check balance only
 *   bun run scripts/fund-irys.ts --amount 0.05          # deposit 0.05 SOL
 *   bun run scripts/fund-irys.ts --amount 0.1 --keypair ~/.config/solana/id.json
 *   bun run scripts/fund-irys.ts --withdraw 0.01        # pull 0.01 SOL back
 */

import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { IRYS_FUNDING_RPC } from '../config/env';
import { createIrys } from './lib/irys-uploader';

const DEFAULT_KEYPAIR = join(homedir(), '.config/solana/id.json');

interface Args {
  keypair: string;
  amount?: number;
  withdraw?: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { keypair: DEFAULT_KEYPAIR };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--keypair':
        args.keypair = argv[++i];
        break;
      case '--amount': {
        const v = Number(argv[++i]);
        if (!Number.isFinite(v) || v <= 0) throw new Error('--amount must be a positive number (SOL)');
        args.amount = v;
        break;
      }
      case '--withdraw': {
        const v = Number(argv[++i]);
        if (!Number.isFinite(v) || v <= 0) throw new Error('--withdraw must be a positive number (SOL)');
        args.withdraw = v;
        break;
      }
      case '--help':
      case '-h':
        console.log(`
Usage:
  bun run scripts/fund-irys.ts                  check balance
  bun run scripts/fund-irys.ts --amount 0.05    deposit 0.05 SOL
  bun run scripts/fund-irys.ts --withdraw 0.01  withdraw 0.01 SOL
  bun run scripts/fund-irys.ts --keypair PATH   override keypair path
`);
        process.exit(0);
    }
  }

  if (args.amount !== undefined && args.withdraw !== undefined) {
    throw new Error('--amount and --withdraw are mutually exclusive');
  }

  return args;
}

async function main() {
  const args = parseArgs();

  console.log('\n=== Irys L1 Funding (mainnet) ===');
  console.log(`  Keypair:    ${args.keypair}`);

  const keypairData = JSON.parse(await readFile(resolve(args.keypair), 'utf-8'));
  const irys = await createIrys(keypairData, IRYS_FUNDING_RPC);

  console.log(`  Solana RPC: ${IRYS_FUNDING_RPC}`);
  console.log(`  Address:    ${irys.address}\n`);

  // Pre-check the deployer's mainnet SOL balance if an action is requested.
  // Irys funding debits mainnet SOL from this wallet; a 0-balance error from
  // the tx simulator is cryptic, so surface it cleanly up front.
  if (args.amount !== undefined) {
    const rpcRes = await fetch(IRYS_FUNDING_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'getBalance',
        params: [irys.address],
      }),
    });
    const rpcJson = (await rpcRes.json()) as { result?: { value: number }; error?: unknown };
    const lamports = rpcJson.result?.value ?? 0;
    const sol = lamports / 1_000_000_000;
    // Rent-exempt minimum on Solana + tx fee buffer
    const required = args.amount + 0.002;
    console.log(`Mainnet SOL balance of deployer: ${sol} SOL`);
    if (sol < required) {
      console.error(
        `\nInsufficient mainnet SOL on ${irys.address}.\n` +
          `  Needed: ~${required} SOL (amount + fee/rent buffer)\n` +
          `  Have:   ${sol} SOL\n\n` +
          `Send real mainnet SOL to this address, then re-run.\n` +
          `(Note: devnet SOL does not count — Irys L1 funding is on mainnet-beta.)\n`,
      );
      process.exit(1);
    }
    console.log('');
  }

  // Balance is returned in atomic units (lamports for SOL)
  const balanceBefore = await irys.getLoadedBalance();
  const humanBefore = irys.utils.fromAtomic(balanceBefore);
  console.log(`Current Irys balance: ${humanBefore.toString()} ${irys.token.toUpperCase()}`);

  if (args.amount !== undefined) {
    const atomic = irys.utils.toAtomic(args.amount);
    console.log(`\nDepositing ${args.amount} ${irys.token.toUpperCase()} (${atomic.toString()} atomic)...`);
    const receipt = await irys.fund(atomic);
    console.log(`  Funded. tx=${receipt.id}`);
    console.log(`  Quantity: ${irys.utils.fromAtomic(receipt.quantity).toString()} ${irys.token.toUpperCase()}`);
    console.log(`  Reward:   ${irys.utils.fromAtomic(receipt.reward).toString()} ${irys.token.toUpperCase()}`);
  }

  if (args.withdraw !== undefined) {
    const atomic = irys.utils.toAtomic(args.withdraw);
    console.log(`\nWithdrawing ${args.withdraw} ${irys.token.toUpperCase()}...`);
    const res = await irys.withdrawBalance(atomic);
    console.log(`  Withdraw tx: ${JSON.stringify(res)}`);
  }

  if (args.amount !== undefined || args.withdraw !== undefined) {
    const balanceAfter = await irys.getLoadedBalance();
    const humanAfter = irys.utils.fromAtomic(balanceAfter);
    console.log(`\nNew Irys balance: ${humanAfter.toString()} ${irys.token.toUpperCase()}`);
  }

  console.log('');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
