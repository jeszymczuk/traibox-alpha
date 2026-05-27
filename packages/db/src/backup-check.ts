import dotenv from 'dotenv';
import { verifyBackupRestoreEvidence } from './migration-guardrails.js';

dotenv.config();

const report = verifyBackupRestoreEvidence(process.env, {
  required: process.env.BACKUP_RESTORE_REQUIRED !== 'false'
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status === 'fail') process.exitCode = 1;
