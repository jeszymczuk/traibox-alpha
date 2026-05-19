import type pg from 'pg';
import { ethers } from 'ethers';
import type { Profile } from '@traibox/profiles';
import { setAppContext, withTx } from '@traibox/db';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

export async function runAnchorLoop(input: { pool: pg.Pool; profile: Profile }): Promise<void> {
  const intervalMs = 30_000;
  // eslint-disable-next-line no-console
  console.log(`Anchor loop every ${intervalMs / 1000}s (enabled=${input.profile.ledger.anchoring.enabled}).`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      if (input.profile.ledger.anchoring.enabled) {
        await tick(input);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('anchor tick error', err);
    }
    await sleep(intervalMs);
  }
}

async function tick(input: { pool: pg.Pool; profile: Profile }): Promise<void> {
  const rpcUrl = process.env.EVM_RPC_URL;
  const pk = process.env.EVM_ANCHOR_WALLET_PRIVATE_KEY;
  const registry = process.env.EVM_ANCHOR_REGISTRY_ADDRESS;
  if (!rpcUrl || !pk || !registry) return;

  const provider = new ethers.JsonRpcProvider(rpcUrl, Number(process.env.EVM_CHAIN_ID ?? input.profile.ledger.anchoring.chain_id));
  const wallet = new ethers.Wallet(pk, provider);
  const contract = new ethers.Contract(
    registry,
    ['function anchor(bytes32 root, bytes32 memo) external', 'event Anchored(bytes32 indexed root, bytes32 indexed memo, address indexed sender, uint256 blockNumber, uint256 ts)'],
    wallet
  );

  const pending = await withTx(input.pool, async (client) => {
    // global scan: use system bypass
    await setAppContext(client, { userId: SYSTEM_USER_ID, orgId: null });
    const res = await client.query(
      `SELECT batch_id, org_id, root, network, status, tx_hash
       FROM anchor_batches
       WHERE status IN ('pending') 
       ORDER BY created_at ASC
       LIMIT 10`
    );
    return res.rows as Array<{ batch_id: string; org_id: string; root: string; network: string; status: string; tx_hash: string | null }>;
  });

  for (const b of pending) {
    if (!b.tx_hash) {
      await submitAnchor({ pool: input.pool, orgId: b.org_id, batchId: b.batch_id, root: b.root, network: b.network, contract });
    } else {
      await pollReceipt({ pool: input.pool, orgId: b.org_id, batchId: b.batch_id, root: b.root, network: b.network, txHash: b.tx_hash, provider });
    }
  }
}

async function submitAnchor(input: { pool: pg.Pool; orgId: string; batchId: string; root: string; network: string; contract: ethers.Contract }) {
  const memo = ethers.keccak256(ethers.toUtf8Bytes(`${input.batchId}:${new Date().toISOString().slice(0, 10)}`));
  const rootBytes32 = `0x${input.root.padStart(64, '0')}` as const;
  const tx = await input.contract.anchor(rootBytes32, memo);
  const tradeId = input.batchId.startsWith('trade-') ? input.batchId.slice('trade-'.length) : null;
  const traceId = `trc_anchor_${crypto.randomUUID().slice(0, 8)}`;

  await withTx(input.pool, async (client) => {
    await setAppContext(client, { userId: SYSTEM_USER_ID, orgId: input.orgId });
    await client.query('UPDATE anchor_batches SET tx_hash=$1, status=$2, adapter_id=$3, memo=$4 WHERE batch_id=$5', [
      tx.hash,
      'pending',
      'evm_event',
      memo,
      input.batchId
    ]);

    await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
      crypto.randomUUID(),
      input.orgId,
      tradeId,
      'ledger.anchor.started',
      traceId,
      'system:worker',
      JSON.stringify({ batch_id: input.batchId, root: input.root, network: input.network, tx_hash: tx.hash, trace_id: traceId })
    ]);
  });
}

async function pollReceipt(input: { pool: pg.Pool; orgId: string; batchId: string; root: string; network: string; txHash: string; provider: ethers.JsonRpcProvider }) {
  const receipt = await input.provider.getTransactionReceipt(input.txHash);
  if (!receipt) return;
  const tradeId = input.batchId.startsWith('trade-') ? input.batchId.slice('trade-'.length) : null;
  const traceId = `trc_anchor_${crypto.randomUUID().slice(0, 8)}`;
  if (receipt.status !== 1) {
    await withTx(input.pool, async (client) => {
      await setAppContext(client, { userId: SYSTEM_USER_ID, orgId: input.orgId });
      await client.query('UPDATE anchor_batches SET status=$1 WHERE batch_id=$2', ['failed', input.batchId]);
      await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
        crypto.randomUUID(),
        input.orgId,
        tradeId,
        'ledger.anchor.failed',
        traceId,
        'system:worker',
        JSON.stringify({ batch_id: input.batchId, root: input.root, network: input.network, tx_hash: input.txHash, reason: 'tx_failed', trace_id: traceId })
      ]);
    });
    return;
  }

  await withTx(input.pool, async (client) => {
    await setAppContext(client, { userId: SYSTEM_USER_ID, orgId: input.orgId });
    await client.query('UPDATE anchor_batches SET status=$1, block_number=$2, anchored_at=now() WHERE batch_id=$3', ['anchored', receipt.blockNumber, input.batchId]);
    await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
      crypto.randomUUID(),
      input.orgId,
      tradeId,
      'ledger.anchor.completed',
      traceId,
      'system:worker',
      JSON.stringify({
        batch_id: input.batchId,
        root: input.root,
        network: input.network,
        tx_hash: input.txHash,
        block_number: receipt.blockNumber,
        anchored_at: new Date().toISOString(),
        trace_id: traceId
      })
    ]);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
