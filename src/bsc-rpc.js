// ============================================
// 🐍 MEDUSA AI — BSC RPC CLIENT
// Direct HTTP calls to BSC RPC for reading on-chain data
// (Polling for AuditCompleted events and reading auditReports)
// ============================================

import { BSC_RPC_ENDPOINTS, MEDUSA_CONTRACT, CONTRACT_ABI, EVENT_TOPICS } from './config.js';

let currentRpcIndex = 0;

/**
 * Make a raw JSON-RPC call to BSC
 */
async function rpcCall(method, params) {
  let lastError;
  
  // Try each RPC endpoint
  for (let attempt = 0; attempt < BSC_RPC_ENDPOINTS.length; attempt++) {
    const rpcUrl = BSC_RPC_ENDPOINTS[(currentRpcIndex + attempt) % BSC_RPC_ENDPOINTS.length];
    
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params,
        }),
      });

      const json = await response.json();
      
      if (json.error) {
        lastError = new Error(json.error.message || JSON.stringify(json.error));
        continue;
      }
      
      // Success — update current index to use this endpoint next time
      currentRpcIndex = (currentRpcIndex + attempt) % BSC_RPC_ENDPOINTS.length;
      return json.result;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('All RPC endpoints failed');
}

/**
 * Get current block number
 */
export async function getBlockNumber() {
  const hex = await rpcCall('eth_blockNumber', []);
  return parseInt(hex, 16);
}

/**
 * Read auditReports(address) from the contract
 * Returns decoded { timestamp, ipfsCid, riskLevel, isSecure, exists } or null
 */
export async function readAuditReport(targetAddress) {
  const data = CONTRACT_ABI.auditReports.encode(targetAddress);
  
  const result = await rpcCall('eth_call', [
    { to: MEDUSA_CONTRACT, data },
    'latest',
  ]);

  return CONTRACT_ABI.auditReports.decode(result);
}

/**
 * Read the current auditFee from the contract
 */
export async function readAuditFee() {
  const data = CONTRACT_ABI.auditFee.encode();
  
  const result = await rpcCall('eth_call', [
    { to: MEDUSA_CONTRACT, data },
    'latest',
  ]);

  if (!result || result === '0x') return '0';
  return BigInt(result).toString();
}

/**
 * Poll for AuditCompleted event for a specific target address
 * Scans recent blocks in batches of 10 (BlastAPI limit)
 */
export async function pollForAuditCompleted(targetAddress, fromBlock) {
  const currentBlock = await getBlockNumber();
  const paddedTarget = '0x' + targetAddress.toLowerCase().replace('0x', '').padStart(64, '0');
  
  // Scan in batches of 10 blocks (BlastAPI limit)
  const BATCH_SIZE = 10;
  const MAX_BATCHES = 5;
  
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const from = fromBlock + (batch * BATCH_SIZE);
    const to = Math.min(from + BATCH_SIZE - 1, currentBlock);
    
    if (from > currentBlock) break;
    
    try {
      const logs = await rpcCall('eth_getLogs', [{
        address: MEDUSA_CONTRACT,
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
        topics: [EVENT_TOPICS.AuditCompleted, paddedTarget],
      }]);

      if (logs && logs.length > 0) {
        return logs[0]; // Found the event
      }
    } catch (err) {
      console.warn(`[Medusa] Batch ${batch} scan error:`, err.message);
    }
  }
  
  return null; // Not found yet
}

/**
 * Keccak256 hash using the Web Crypto API (for creating target pseudo-addresses)
 * Falls back to a simple hash if needed
 */
export function keccak256FromSource(sourceCode) {
  // We'll use a simple approach: hash the source to create a deterministic address
  // In production, the user would deploy the contract first and audit the deployed address
  // For the plugin, we create a pseudo-address from the source code hash
  let hash = 0n;
  for (let i = 0; i < sourceCode.length; i++) {
    hash = ((hash << 5n) - hash + BigInt(sourceCode.charCodeAt(i))) & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn;
  }
  return '0x' + hash.toString(16).padStart(40, '0');
}
