/**
 * Result Isolation
 *
 * Re-exports the core result isolation module. Defense logic lives in
 * @usenella/core so that any consumer (benchmark, playground, MCP server)
 * gets defense automatically.
 */

export {
  // Constants
  SEARCH_PREAMBLE,
  SEARCH_PREAMBLE_COMPACT,
  SEARCH_EPILOGUE,
  SEARCH_EPILOGUE_COMPACT,
  // Functions
  generateNonce,
  stripToken,
  wrapSearchResult,
  wrapSearchResponse,
} from "@usenella/core";

export type {
  ResultIsolationOptions,
  WrappedResult,
} from "@usenella/core";
