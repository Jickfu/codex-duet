export const LOCAL_LIMITS = Object.freeze({
  files: 20_000,
  capturedBytes: 256 * 1024 * 1024,
  singleFileBytes: 8 * 1024 * 1024,
  readResponseBytes: 256 * 1024,
  directoryPageEntries: 500,
  searchResults: 200,
  materializedDiffBytes: 8 * 1024 * 1024,
  gitEnumerationBytes: 128 * 1024 * 1024,
});
