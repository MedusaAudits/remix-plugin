// ============================================
// 🐍 MEDUSA AI — REMIX PLUGIN CORE LOGIC
// Connects to Remix IDE and handles the full audit flow
// ============================================

import { createClient } from '@remixproject/plugin-webview';
import {
  MEDUSA_CONTRACT,
  BSC_CHAIN_ID,
  BSC_CHAIN_ID_HEX,
  TIER_CONFIG,
  RISK_LABELS,
  SCORE_MAP,
  CONTRACT_ABI,
} from './config.js';
import { readAuditReport, getBlockNumber } from './bsc-rpc.js';

// ============================================
// STATE
// ============================================
let client = null;
let currentFilePath = '';
let currentSource = '';
let selectedTier = 'express';
let isAuditing = false;
let auditStartBlock = 0;
let connectionRetries = 0;
const MAX_RETRIES = 3;

// ============================================
// DOM HELPERS
// ============================================
const $ = (id) => document.getElementById(id);

function setStatus(connected, text) {
  const dot = $('statusDot');
  const txt = $('statusText');
  if (connected) {
    dot.classList.add('connected');
  } else {
    dot.classList.remove('connected');
  }
  txt.textContent = text;
}

function showNetworkWarning(show) {
  const el = $('networkWarning');
  if (show) el.classList.add('visible');
  else el.classList.remove('visible');
}

function updateStep(num, state) {
  const el = $(`step${num}`);
  if (!el) return;
  el.className = `p-step ${state}`;
}

function resetSteps() {
  for (let i = 1; i <= 4; i++) {
    const el = $(`step${i}`);
    if (el) {
      el.className = 'p-step';
    }
  }
}

async function logToTerminal(message) {
  if (!client) return;
  try {
    await client.call('terminal', 'log', { type: 'html', value: `<span style="color:#00e87b">${message}</span>` });
  } catch (e) {
    console.log(message);
  }
}

// ============================================
// TIER SELECTION
// ============================================
window.selectTier = function (tier) {
  selectedTier = tier;
  const expressCard = $('tierExpress');
  const premiumCard = $('tierPremium');
  const btn = $('auditBtn');

  if (tier === 'express') {
    expressCard.classList.add('selected');
    premiumCard.classList.remove('selected');
    btn.className = 'cta-button express';
    btn.querySelector('.cta-label').textContent = 'Request Audit';
    btn.querySelector('.cta-price').textContent = '0.05 BNB';
  } else {
    expressCard.classList.remove('selected');
    premiumCard.classList.add('selected');
    btn.className = 'cta-button premium';
    btn.querySelector('.cta-label').textContent = 'Deep Scan';
    btn.querySelector('.cta-price').textContent = '0.5 BNB';
  }
};

// ============================================
// REQUEST AUDIT — MAIN FLOW
// ============================================
window.requestAudit = async function () {
  if (isAuditing || !client) return;

  // Validate .sol file is open
  if (!currentFilePath || !currentFilePath.endsWith('.sol')) {
    alert('🐍 Open a Solidity (.sol) file in Remix to begin auditing.');
    return;
  }

  if (!currentSource || currentSource.trim().length === 0) {
    alert('🐍 The current file appears to be empty.');
    return;
  }

  isAuditing = true;
  const btn = $('auditBtn');
  const progress = $('progressSection');
  const results = $('resultsSection');

  // Update CTA to processing state
  btn.disabled = true;
  const ctaContent = btn.querySelector('.cta-content');
  ctaContent.innerHTML = '<span class="spinner"></span><span class="cta-label">Processing...</span>';

  progress.classList.add('visible');
  results.classList.remove('visible');
  resetSteps();

  const tierConfig = TIER_CONFIG[selectedTier];

  try {
    // ── Step 1: Prepare transaction ──
    updateStep(1, 'active');
    await logToTerminal(`🐍 [Medusa] Requesting ${selectedTier.toUpperCase()} audit for: ${currentFilePath}`);
    await logToTerminal(`🐍 [Medusa] Fee: ${tierConfig.priceDisplay}`);

    // Check if user pasted a target address, otherwise generate from source hash
    const manualTarget = $('targetAddress')?.value?.trim();
    let targetAddress;

    if (manualTarget && /^0x[a-fA-F0-9]{40}$/.test(manualTarget)) {
      targetAddress = manualTarget;
      await logToTerminal(`🐍 [Medusa] Target: ${targetAddress} (user-provided)`);
    } else {
      targetAddress = generateTargetAddress(currentSource);
      await logToTerminal(`🐍 [Medusa] Target: ${targetAddress} (auto from source hash)`);
    }

    // Encode requestAudit(address) function call
    const calldata = CONTRACT_ABI.requestAudit.encode(targetAddress);

    // Record block number before sending TX (for event polling)
    try {
      auditStartBlock = await getBlockNumber();
    } catch (e) {
      auditStartBlock = 0;
    }

    // ── Step 2: Send TX via Remix udapp ──
    updateStep(1, 'done');
    updateStep(2, 'active');

    const txReceipt = await client.call('udapp', 'sendTransaction', {
      from: '',
      to: MEDUSA_CONTRACT,
      value: tierConfig.priceHex,
      data: calldata,
      gasLimit: '150000',
    });

    const txHash = txReceipt?.transactionHash || txReceipt?.hash || '';
    await logToTerminal(`🐍 [Medusa] ✅ TX sent! Hash: ${txHash || 'pending...'}`);

    updateStep(2, 'done');
    updateStep(3, 'active');

    // ── Step 3: Poll for Oracle response ──
    await logToTerminal(`🐍 [Medusa] ⏳ Waiting for Oracle to process audit...`);

    const auditResult = await pollForResult(targetAddress, tierConfig);

    if (auditResult) {
      updateStep(3, 'done');
      updateStep(4, 'done');

      displayResults({
        timestamp: auditResult.timestamp,
        ipfsCid: auditResult.ipfsCid,
        riskLevel: auditResult.riskLevel,
        isSecure: auditResult.isSecure,
        targetAddress,
        txHash,
      });

      await logToTerminal(
        `🐍 [Medusa] ✅ Audit complete! Risk: ${RISK_LABELS[auditResult.riskLevel]} | Secure: ${auditResult.isSecure}`
      );
    } else {
      await logToTerminal(`🐍 [Medusa] ⏳ Oracle is still processing. The result will appear on-chain when ready.`);
      progress.classList.remove('visible');
      resetButton();
    }
  } catch (err) {
    console.error('[Medusa] Audit error:', err);

    let errorMsg = err.message || 'Transaction failed';
    if (errorMsg.includes('insufficient funds')) {
      errorMsg = 'Insufficient BNB balance. You need at least ' + tierConfig.priceDisplay;
    } else if (errorMsg.includes('user rejected') || errorMsg.includes('User denied')) {
      errorMsg = 'Transaction cancelled by user';
    } else if (errorMsg.includes('chain') || errorMsg.includes('network')) {
      errorMsg = 'Wrong network! Switch to BSC Mainnet (Chain ID: 56) in MetaMask';
      showNetworkWarning(true);
    }

    await logToTerminal(`🐍 [Medusa] ❌ Error: ${errorMsg}`);
    alert('🐍 Medusa Error: ' + errorMsg);
  } finally {
    isAuditing = false;
    if (!$('resultsSection').classList.contains('visible')) {
      resetButton();
      progress.classList.remove('visible');
    }
  }
};

// ============================================
// POLL FOR ORACLE RESULT
// ============================================
async function pollForResult(targetAddress, tierConfig) {
  const startTime = Date.now();

  while (Date.now() - startTime < tierConfig.timeout) {
    try {
      const report = await readAuditReport(targetAddress);
      if (report && report.exists) {
        return report;
      }
    } catch (e) {
      console.warn('[Medusa] Poll error:', e.message);
    }

    await sleep(tierConfig.pollInterval);

    // Update progress indicator
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    $('progressSubtitle').textContent = `Scanning for vulnerabilities... (${elapsed}s)`;
  }

  return null;
}

// ============================================
// DISPLAY RESULTS
// ============================================
function displayResults({ timestamp, ipfsCid, riskLevel, isSecure, targetAddress, txHash }) {
  const progress = $('progressSection');
  const results = $('resultsSection');

  progress.classList.remove('visible');
  results.classList.add('visible');

  const score = SCORE_MAP[riskLevel] || 50;

  // Banner styling based on result
  const banner = $('resultHeader');
  if (isSecure) {
    banner.className = 'result-banner secure';
    $('resultTitle').textContent = '✅ Contract Secure';
  } else if (riskLevel >= 3) {
    banner.className = 'result-banner danger';
    $('resultTitle').textContent = '🚨 Critical Issues';
  } else {
    banner.className = 'result-banner warning';
    $('resultTitle').textContent = '⚠️ Issues Detected';
  }

  // Score number
  $('resultScore').textContent = score;

  // Circular SVG score ring (circumference of r=30 circle = 2*π*30 ≈ 188.5)
  const circumference = 188.5;
  const filled = (score / 100) * circumference;
  const circleFill = $('scoreFillCircle');
  if (circleFill) {
    circleFill.setAttribute('stroke-dasharray', `${filled} ${circumference - filled}`);
    // Color based on score
    if (score >= 80) circleFill.style.stroke = 'var(--m-green)';
    else if (score >= 60) circleFill.style.stroke = 'var(--m-warn)';
    else if (score >= 40) circleFill.style.stroke = 'var(--m-warn)';
    else circleFill.style.stroke = 'var(--m-danger)';
  }

  // Hidden compat elements
  const scoreText = $('scoreText');
  if (scoreText) scoreText.textContent = `${score}/100`;

  // Details
  $('resultStatus').textContent = isSecure ? '✅ Secure' : '⚠️ Vulnerabilities Found';
  $('resultRisk').textContent = RISK_LABELS[riskLevel] || 'UNKNOWN';
  $('resultTimestamp').textContent =
    timestamp > 0 ? new Date(timestamp * 1000).toLocaleString() : 'Pending';
  $('resultCID').textContent = ipfsCid ? ipfsCid.substring(0, 24) + '...' : 'N/A';

  // TX link
  const txLink = $('txLink');
  if (txHash) {
    txLink.href = `https://bscscan.com/tx/${txHash}`;
    txLink.style.display = 'flex';
  }

  // Reset button
  resetButton();
  const btn = $('auditBtn');
  const label = btn.querySelector('.cta-label');
  if (label) label.textContent = 'Audit Again';
}

// ============================================
// HELPERS
// ============================================
function generateTargetAddress(sourceCode) {
  let hash = 5381n;
  for (let i = 0; i < sourceCode.length; i++) {
    hash = ((hash << 5n) + hash + BigInt(sourceCode.charCodeAt(i))) & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn;
  }
  return '0x' + hash.toString(16).padStart(40, '0');
}

function resetButton() {
  const btn = $('auditBtn');
  btn.disabled = false;

  const coinSrc = '/medusa-coin.png';
  const tierConf = TIER_CONFIG[selectedTier];

  btn.className = `cta-button ${selectedTier}`;
  const ctaContent = btn.querySelector('.cta-content');
  if (ctaContent) {
    ctaContent.innerHTML = `
      <img src="${coinSrc}" class="cta-coin" alt="" />
      <span class="cta-label">${selectedTier === 'express' ? 'Request Audit' : 'Deep Scan'}</span>
      <span class="cta-price">${tierConf.priceDisplay}</span>
    `;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================
// INITIALIZE REMIX CLIENT
// ============================================
async function init() {
  setStatus(false, 'Connecting to Remix IDE...');

  try {
    // createClient() establishes the postMessage handshake with the Remix IDE
    // host. It MUST be called immediately on load — do NOT delay this call.
    client = createClient();

    // Set a connection timeout — if onload doesn't fire in 15s, the handshake
    // likely failed (e.g. the page was opened outside of Remix).
    let loadFired = false;

    const connectionTimeout = setTimeout(() => {
      if (!loadFired) {
        console.warn('[Medusa] Connection timeout — onload did not fire in 15s');
        setStatus(false, 'Waiting for Remix IDE...');

        // Retry logic — sometimes the iframe loads before the host is ready
        if (connectionRetries < MAX_RETRIES) {
          connectionRetries++;
          console.log(`[Medusa] Retry ${connectionRetries}/${MAX_RETRIES}...`);
          setStatus(false, `Retrying... (${connectionRetries}/${MAX_RETRIES})`);
          // Re-attempt by calling handshake again after a short delay
          setTimeout(() => {
            try {
              client.onload(onPluginLoaded);
            } catch (e) {
              console.warn('[Medusa] Retry handshake failed:', e.message);
            }
          }, 2000);
        }
      }
    }, 15000);

    async function onPluginLoaded() {
      loadFired = true;
      clearTimeout(connectionTimeout);
      connectionRetries = 0;

      console.log('🐍 Medusa plugin connected to Remix IDE');
      setStatus(true, 'Connected to Remix IDE');
      $('auditBtn').disabled = false;

      // Load current file
      try {
        currentFilePath = await client.call('fileManager', 'getCurrentFile');
        currentSource = await client.call('fileManager', 'readFile', currentFilePath);
        $('currentFile').textContent = currentFilePath;
      } catch (e) {
        $('currentFile').textContent = 'Open a .sol file to begin';
      }

      // Listen for file changes
      client.on('fileManager', 'currentFileChanged', async (filePath) => {
        currentFilePath = filePath;
        try {
          currentSource = await client.call('fileManager', 'readFile', filePath);
          $('currentFile').textContent = filePath;
        } catch (e) {
          currentSource = '';
          $('currentFile').textContent = filePath + ' (unable to read)';
        }
      });

      // Listen for file saves (content updates)
      client.on('fileManager', 'fileSaved', async (filePath) => {
        if (filePath === currentFilePath) {
          try {
            currentSource = await client.call('fileManager', 'readFile', filePath);
          } catch (e) { /* ignore */ }
        }
      });

      // Log welcome to Remix terminal
      await logToTerminal('🐍 Medusa AI Auditor v2.0.0 loaded! ERC-8004 Agent #127076 | Open a .sol file → select tier → click audit.');
    }

    // Register the onload callback
    client.onload(onPluginLoaded);

  } catch (err) {
    console.error('🐍 Plugin init error:', err);
    setStatus(false, 'Connection error — reload plugin');
  }
}

// ============================================
// BOOT — Execute immediately, don't wait for DOMContentLoaded
// The Remix plugin handshake MUST start as soon as possible
// ============================================
init();
window.selectTier('express');
