// ============================================
// 🐍 MEDUSA AI — REMIX PLUGIN CONFIGURATION
// ============================================

// Contract V2 with ERC-8004 + dual-tier pricing (deployed 2026-06-04, agentId #127076)
export const MEDUSA_CONTRACT = '0xC0893Af3EdA67F1fEfc73DF82192de97258692Ea';
export const BSC_CHAIN_ID = 56;
export const BSC_CHAIN_ID_HEX = '0x38';

// RPC endpoints for reading on-chain data (event polling)
export const BSC_RPC_ENDPOINTS = [
  'https://bsc-mainnet.public.blastapi.io',
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-dataseed3.binance.org',
];

// Tier pricing in BNB
export const TIER_CONFIG = {
  express: {
    name: 'Express',
    priceDisplay: '0.05 BNB',
    priceWei: '50000000000000000',   // 0.05 * 1e18
    priceHex: '0xB1A2BC2EC50000',    // 0.05 BNB in hex wei
    timeout: 180000,                  // 3 minutes
    pollInterval: 5000,               // 5 seconds
  },
  premium: {
    name: 'Premium',
    priceDisplay: '0.5 BNB',
    priceWei: '500000000000000000',   // 0.5 * 1e18
    priceHex: '0x6F05B59D3B20000',   // 0.5 BNB in hex wei
    timeout: 1800000,                 // 30 minutes
    pollInterval: 10000,              // 10 seconds
  },
};

// Risk level labels (matches Solidity enum)
export const RISK_LABELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

// Score mapping for display (risk level → approximate score)
export const SCORE_MAP = { 0: 92, 1: 68, 2: 42, 3: 18 };

// ABI fragments for the MedusaAIAuditor contract
export const CONTRACT_ABI = {
  // Function selectors (first 4 bytes of keccak256)
  requestAudit: {
    // requestAudit(address) → 0xe34eac65
    selector: '0xe34eac65',
    encode: (targetAddress) => {
      // ABI encode: selector + address padded to 32 bytes
      const addr = targetAddress.toLowerCase().replace('0x', '').padStart(64, '0');
      return '0xe34eac65' + addr;
    }
  },
  auditReports: {
    // auditReports(address) → 0x2da7686b
    selector: '0x2da7686b',
    encode: (targetAddress) => {
      const addr = targetAddress.toLowerCase().replace('0x', '').padStart(64, '0');
      return '0x2da7686b' + addr;
    },
    // Decode the tuple (uint256 timestamp, string ipfsCid, uint8 riskLevel, bool isSecure, bool exists)
    decode: (data) => {
      if (!data || data === '0x' || data.length < 66) return null;
      const hex = data.replace('0x', '');

      // timestamp: first 32 bytes
      const timestamp = parseInt(hex.substring(0, 64), 16);

      // The string (ipfsCid) is ABI-encoded with offset/length
      // Offset to string data is at position 32-64 bytes
      const stringOffset = parseInt(hex.substring(64, 128), 16) * 2;
      const stringLength = parseInt(hex.substring(stringOffset, stringOffset + 64), 16);
      const stringHex = hex.substring(stringOffset + 64, stringOffset + 64 + stringLength * 2);
      let ipfsCid = '';
      for (let i = 0; i < stringHex.length; i += 2) {
        ipfsCid += String.fromCharCode(parseInt(stringHex.substring(i, i + 2), 16));
      }

      // riskLevel: uint8 at position 128-192
      const riskLevel = parseInt(hex.substring(128, 192), 16);

      // isSecure: bool at position 192-256
      const isSecure = parseInt(hex.substring(192, 256), 16) !== 0;

      // exists: bool at position 256-320
      const exists = parseInt(hex.substring(256, 320), 16) !== 0;

      return { timestamp, ipfsCid, riskLevel, isSecure, exists };
    }
  },
  auditFee: {
    // auditFee() → 0x3d6dfe73
    selector: '0x3d6dfe73',
    encode: () => '0x3d6dfe73',
  }
};

// Event topics (keccak256 hashes from the walkthrough)
export const EVENT_TOPICS = {
  AuditRequested: '0xd98e915a1d962fce5f7d544057ca496aaf7abb5a8516970b81b185ce8212eb1f',
  AuditCompleted: '0x17a61cbe383f5db1c301bcfb0655baa5e6dc00498d97d30c29717ea26560706f',
};
