import dotenv from 'dotenv';
dotenv.config();

import { loadProfileFromFile } from '@traibox/profiles';
import { createPool } from '@traibox/db';

import { runAnchorLoop } from './jobs/anchor.js';
import { runBankSyncLoop } from './jobs/bank_sync.js';

const profilePath = process.env.DEPLOYMENT_PROFILE_PATH ?? 'packages/profiles/profiles/dev.yaml';
const profile = loadProfileFromFile(profilePath);
const pool = createPool(process.env.DATABASE_URL!);

// eslint-disable-next-line no-console
console.log(`Worker started (profile=${profile.profile_id}).`);

await Promise.all([runAnchorLoop({ pool, profile }), runBankSyncLoop({ pool, profile })]);
