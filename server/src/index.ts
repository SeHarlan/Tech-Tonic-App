import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { route as updateNftRoute } from './routes/update-nft.ts';
import { ALLOWED_ORIGINS, PORT } from './config.ts';
import { getIrys } from './lib/irys.ts';

// Warm up the Irys uploader at boot so the first real request doesn't pay the
// builder handshake latency. Errors here will resurface on the first use.
getIrys().catch((err) => console.error('[irys] warm-up failed:', err));

const app = new Hono();

// CORS — allow frontend origin(s) + Capacitor mobile
app.use(
  '*',
  cors({
    origin: ALLOWED_ORIGINS,
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
);

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Routes
app.route('/', updateNftRoute);

console.log(`[server] Listening on port ${PORT}`);

export default {
  port: PORT,
  hostname: '0.0.0.0',
  fetch: app.fetch,
};
