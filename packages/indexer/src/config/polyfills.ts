/* eslint-disable @typescript-eslint/no-explicit-any */

// References:
// https://github.com/apollographql/apollo-link-rest/issues/41#issuecomment-354923559
// https://github.com/node-fetch/node-fetch#providing-global-access
import fetch, { Headers, Request, Response } from "node-fetch";
import { Logger as EthersLogger } from "@ethersproject/logger";
if (!global.fetch) {
  (global as any).fetch = fetch;
  (global as any).Headers = Headers;
  (global as any).Request = Request;
  (global as any).Response = Response;
}

// Suppress extremely noisy ethers Interface duplicate-definition warnings which
// are benign (e.g., "duplicate definition - supportsInterface(bytes4)"). These
// can appear when composing ABIs that include ERC165 fragments multiple times.
// We filter just that specific warning pattern to avoid hiding other warnings.
// See: node_modules/@ethersproject/abi/src.ts/interface.ts
try {
  const originalWarn = console.warn.bind(console);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.warn = (...args: any[]) => {
    const msg = args && args.length ? String(args[0]) : "";
    if (
      typeof msg === "string" &&
      msg.includes("duplicate definition - ") &&
      msg.includes("supportsInterface(bytes4)")
    ) {
      return;
    }
    originalWarn(...args);
  };
} catch {
  // Ignore if console is not writable
}

// Reduce ethers.js log noise (e.g., ABI duplicate warnings) to errors only.
// This still allows actual errors through while silencing warning/info/debug
// that are printed via the ethers internal Logger (which uses console.log).
try {
  // Only change ethers' logger level; does not affect our app logger.
  EthersLogger.setLogLevel(EthersLogger.levels.ERROR);
} catch {
  // Ignore if logger is unavailable
}
