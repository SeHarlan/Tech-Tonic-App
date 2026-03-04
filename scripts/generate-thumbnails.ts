import { chromium, type Browser, type BrowserContext } from 'playwright';
import { spawn, type ChildProcess } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomizeShaderParameters } from '../src/engine/parameters';

// --- Constants ---

const SEED_MODULUS = 1000;
const DEFAULT_COUNT = 10;
const DEFAULT_DURATION_SECS = 60;
const DEFAULT_COOLDOWN_SECS = 5;
const DEFAULT_OUTPUT = './thumbnails';
const TARGET_FPS = 60;
const VITE_PORT = 5199;
const VIEWPORT = { width: 1080, height: 1920 };

// --- Window / engine globals (injected by app for thumbnail capture) ---

interface EngineGlobals {
  __engineReady?: boolean;
  __engine?: {
    getTotalFrameCount(): number;
    captureScreenshotBase64(): string;
  };
}

type WindowWithEngine = Window & EngineGlobals;

// --- Arg parsing ---

interface Args {
  count: number;
  duration: number;
  cooldown: number;
  output: string;
  seeds: number[] | null;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    count: DEFAULT_COUNT,
    duration: DEFAULT_DURATION_SECS,
    cooldown: DEFAULT_COOLDOWN_SECS,
    output: DEFAULT_OUTPUT,
    seeds: null,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--count':
        args.count = parseInt(argv[++i], 10);
        break;
      case '--duration':
        args.duration = parseInt(argv[++i], 10);
        break;
      case '--cooldown':
        args.cooldown = parseInt(argv[++i], 10);
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--seeds':
        args.seeds = argv[++i].split(',').map((s) => parseInt(s.trim(), 10));
        break;
    }
  }

  return args;
}

// --- Seed generation ---

function generateSeeds(count: number): number[] {
  const seeds = new Set<number>();
  while (seeds.size < Math.min(count, SEED_MODULUS)) {
    seeds.add(Math.floor(Math.random() * SEED_MODULUS));
  }
  return [...seeds];
}

// --- Vite dev server ---

function startVite(): Promise<{ process: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const vite = spawn('bunx', ['vite', '--port', String(VITE_PORT)], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const timeout = setTimeout(() => {
      reject(new Error('Vite dev server failed to start within 30s'));
    }, 30_000);

    vite.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      // Vite prints the local URL when ready
      const match = text.match(/Local:\s+(https?:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve({ process: vite, url: match[1] });
      }
    });

    vite.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      // Vite sometimes outputs to stderr too
      if (text.includes('error')) {
        console.error('[vite stderr]', text);
      }
    });

    vite.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    vite.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Vite exited with code ${code}`));
    });
  });
}

// --- Sleep ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Main ---

async function main() {
  const args = parseArgs();
  const seeds = args.seeds ?? generateSeeds(args.count);
  const targetFrames = args.duration * TARGET_FPS;

  console.log(`\n=== Thumbnail Generator ===`);
  console.log(`  Seeds:    ${seeds.length} (${seeds.slice(0, 5).join(', ')}${seeds.length > 5 ? '...' : ''})`);
  console.log(`  Duration: ${args.duration}s per seed (~${targetFrames} frames)`);
  console.log(`  Cooldown: ${args.cooldown}s between runs`);
  console.log(`  Output:   ${args.output}\n`);

  // Ensure output directory
  await mkdir(args.output, { recursive: true });

  // Start Vite
  console.log('Starting Vite dev server...');
  const vite = await startVite();
  console.log(`Vite ready at ${vite.url}\n`);

  const browser: Browser = await chromium.launch({
    headless: false,
    args: ['--use-gl=angle'],
  });
  console.log('Browser launched\n');

  interface NftAttribute {
    trait_type: string;
    value: string;
  }

  const metadata: {
    generatedAt: string;
    count: number;
    durationSeconds: number;
    thumbnails: { filename: string; seed: number; totalFrameCount: number; attributes: NftAttribute[] }[];
  } = {
    generatedAt: new Date().toISOString(),
    count: seeds.length,
    durationSeconds: args.duration,
    thumbnails: [],
  };

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const paddedSeed = String(seed).padStart(3, '0');
    const filename = `seed-${paddedSeed}.png`;

    console.log(`[${i + 1}/${seeds.length}] Seed ${seed} — evolving for ${args.duration}s...`);

    let context: BrowserContext | null = null;
    try {
      // Fresh context per seed for memory safety
      context = await browser.newContext({ viewport: VIEWPORT });
      const page = await context.newPage();

      // Log page errors for diagnostics
      page.on('pageerror', (err) => console.error(`  [page error] ${err.message}`));

      // Navigate to generate page
      const baseUrl = vite.url.replace(/\/+$/, '');
      await page.goto(`${baseUrl}/generate?seed=${seed}`, { waitUntil: 'domcontentloaded' });

      // Wait for engine to be ready
      await page.waitForFunction(
        () => (window as WindowWithEngine).__engineReady === true,
        null,
        { timeout: 30_000 },
      );

      // Wait for target frame count
      await page.waitForFunction(
        (target: number) => {
          const engine = (window as WindowWithEngine).__engine;
          return engine && engine.getTotalFrameCount() >= target;
        },
        targetFrames,
        { timeout: args.duration * 3_000 },
      );

      // Get actual frame count
      const totalFrameCount: number = await page.evaluate(() => {
        return (window as WindowWithEngine).__engine!.getTotalFrameCount();
      });

      // Capture screenshot from engine (renders from WebGL framebuffer)
      const base64: string = await page.evaluate(() => {
        return (window as WindowWithEngine).__engine!.captureScreenshotBase64();
      });

      // Decode and write PNG
      const pngBuffer = Buffer.from(base64.replace(/^data:image\/png;base64,/, ''), 'base64');
      await writeFile(join(args.output, filename), pngBuffer);

      const params = randomizeShaderParameters(seed);
      const attributes: NftAttribute[] = [
        { trait_type: 'Seed', value: String(seed) },
        { trait_type: 'Pattern', value: params.fxWithBlocking ? 'Blocked' : 'Flowing' },
        { trait_type: 'Block Scale', value: String(params.blockingScale) },
        { trait_type: 'Waterfall', value: params.defaultWaterfallMode ? 'On' : 'Off' },
        { trait_type: 'Edge Noise', value: params.blackNoiseEdgeMult === 0 ? 'None' : 'Subtle' },
      ];

      metadata.thumbnails.push({ filename, seed, totalFrameCount, attributes });
      console.log(`  -> ${filename} (${totalFrameCount} frames)\n`);
    } catch (err) {
      console.error(`  !! Failed for seed ${seed}:`, err instanceof Error ? err.message : err);
    } finally {
      if (context) await context.close();
    }

    // Cooldown between runs (skip after last)
    if (i < seeds.length - 1 && args.cooldown > 0) {
      console.log(`  Cooling down ${args.cooldown}s...`);
      await sleep(args.cooldown * 1000);
    }
  }

  // Write metadata
  const metadataPath = join(args.output, 'metadata.json');
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  console.log(`\nMetadata written to ${metadataPath}`);
  console.log(`Generated ${metadata.thumbnails.length}/${seeds.length} thumbnails`);

  // Cleanup
  await browser.close();
  vite.process.kill('SIGTERM');
  console.log('Done!\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
