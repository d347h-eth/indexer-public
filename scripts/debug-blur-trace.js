#!/usr/bin/env node
/**
 * Debug script to inspect the trace structure for the problematic Blur V2 transaction
 * Usage: node debug-blur-trace.js
 */

const { ethers } = require('ethers');

const TX_HASH = '0x7c9993552f4d94ec8c788e7e0a4f5644dea15697cdf56d4d0784703d4f8814be';
const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const BLUR_EXCHANGE = '0xb2ecfe4e4d61f8790bbb9de2d1259b9e2410cea5';
const TAKE_ASK_SINGLE_SELECTOR = '0x70bce2d6';

async function main() {
  console.log('Connecting to RPC:', RPC_URL);
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

  console.log('\n=== Fetching Transaction ===');
  const tx = await provider.getTransaction(TX_HASH);
  console.log('To:', tx.to);
  console.log('Data (first 10 bytes):', tx.data.slice(0, 10));
  console.log('Expected selector:', TAKE_ASK_SINGLE_SELECTOR);
  console.log('Selector matches:', tx.data.startsWith(TAKE_ASK_SINGLE_SELECTOR));

  console.log('\n=== Fetching Trace via debug_traceTransaction ===');
  try {
    const trace = await provider.send('debug_traceTransaction', [
      TX_HASH,
      { tracer: 'callTracer' }
    ]);

    console.log('\nTrace structure keys:', Object.keys(trace));
    console.log('Has "calls" property:', 'calls' in trace);
    console.log('Has "result" property:', 'result' in trace);

    // Show the root call
    console.log('\n=== Root Call ===');
    console.log('Type:', trace.type);
    console.log('From:', trace.from);
    console.log('To:', trace.to);
    console.log('Input (first 10 bytes):', trace.input?.slice(0, 10));
    console.log('Gas:', trace.gas);
    console.log('Value:', trace.value);

    // Check if root matches
    console.log('\n=== Root Call Analysis ===');
    console.log('Root "to":', trace.to);
    console.log('Root "to" lowercase:', trace.to?.toLowerCase());
    console.log('Expected Exchange:', BLUR_EXCHANGE);
    console.log('Root "to" matches Exchange:', trace.to?.toLowerCase() === BLUR_EXCHANGE);
    console.log('Root input:', trace.input?.slice(0, 10));
    console.log('Root input starts with takeAskSingle:', trace.input?.startsWith(TAKE_ASK_SINGLE_SELECTOR));

    // Simulate the indexer's logic
    const selectors = new Set([TAKE_ASK_SINGLE_SELECTOR]);
    console.log('\nSimulating root check:');
    console.log('  rootTrace.to?.toLowerCase() === exchangeAddress:', trace.to?.toLowerCase() === BLUR_EXCHANGE);
    console.log('  rootTrace.input:', !!trace.input);
    console.log('  selectors.has(input.slice(0,10)):', selectors.has(trace.input?.slice(0, 10)));
    const wouldMatch = trace.to?.toLowerCase() === BLUR_EXCHANGE && trace.input && selectors.has(trace.input.slice(0, 10));
    console.log('  WOULD MATCH AT ROOT:', wouldMatch);

    // Show nested structure
    if (trace.calls && Array.isArray(trace.calls)) {
      console.log('\n=== Nested Calls ===');
      console.log('Number of calls:', trace.calls.length);

      // Search for the takeAskSingle call
      const searchCalls = (node, depth = 0) => {
        const indent = '  '.repeat(depth);
        if (node.to && node.input) {
          const isExchange = node.to.toLowerCase() === BLUR_EXCHANGE;
          const isTakeAskSingle = node.input.startsWith(TAKE_ASK_SINGLE_SELECTOR);
          console.log(`${indent}${node.type || 'CALL'} to ${node.to.slice(0, 10)}... input: ${node.input.slice(0, 10)} ${isExchange ? '[EXCHANGE]' : ''} ${isTakeAskSingle ? '[TAKE_ASK_SINGLE]' : ''}`);
        }
        if (node.calls && Array.isArray(node.calls)) {
          node.calls.forEach(c => searchCalls(c, depth + 1));
        }
      };

      trace.calls.forEach(c => searchCalls(c, 1));
    } else {
      console.log('No nested calls array found');
    }

    // Show full trace (truncated)
    console.log('\n=== Full Trace (JSON) ===');
    console.log(JSON.stringify(trace, null, 2).slice(0, 2000) + '...');

  } catch (error) {
    console.error('Error fetching trace:', error.message);
    console.error(error);
  }
}

main().catch(console.error);
