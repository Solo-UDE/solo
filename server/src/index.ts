/**
 * Solo Server — Hono + Bun entry point.
 *
 * Runs the AI agent loop using Vercel AI SDK and communicates with
 * the Solo desktop app over WebSocket for tool execution.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import agentRoutes, { websocket } from './routes/agent-routes';

// Global error handlers
process.on('uncaughtException', (error: Error) => {
  console.error('[Solo Server] Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('[Solo Server] Unhandled Rejection:', reason);
});

const app = new Hono();

// CORS
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return '*';
      if (origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('tauri')) {
        return origin;
      }
      return origin;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// Root / health endpoint
app.get('/', (c) => {
  return c.json({
    message: 'Solo AI Server',
    version: '0.1.0',
  });
});

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Mount agent routes
app.route('/agent', agentRoutes);

// Global error handler
app.onError((err, c) => {
  console.error('[Solo Server] HTTP Error:', err);
  return c.json(
    {
      error: err.message || 'Internal Server Error',
      timestamp: new Date().toISOString(),
    },
    500
  );
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: 'Not Found',
      path: c.req.path,
    },
    404
  );
});

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

console.log(`[Solo Server] Starting on port ${port}...`);

export default {
  port,
  fetch: app.fetch,
  websocket,
  idleTimeout: 0,
};
