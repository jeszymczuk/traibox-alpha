import dotenv from 'dotenv';
dotenv.config();

import { buildServer } from './server.js';

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? '0.0.0.0';

const server = await buildServer();
await server.listen({ port, host });

// eslint-disable-next-line no-console
console.log(`API listening on http://${host}:${port}`);

