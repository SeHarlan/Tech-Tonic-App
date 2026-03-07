import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { route as updateNftRoute } from './routes/update-nft.ts';
import { ALLOWED_ORIGINS, PORT } from './config.ts';

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
  fetch: app.fetch,
};
