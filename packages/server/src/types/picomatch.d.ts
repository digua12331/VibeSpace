// Minimal ambient types for picomatch — we can't pull @types/picomatch offline,
// and the only surface we rely on is `picomatch.isMatch(str, pattern, options)`.
declare module "picomatch" {
  interface PicomatchOptions {
    dot?: boolean;
    nocase?: boolean;
    [k: string]: unknown;
  }
  interface PicomatchApi {
    isMatch(
      input: string,
      patterns: string | string[],
      options?: PicomatchOptions,
    ): boolean;
  }
  const picomatch: PicomatchApi;
  export default picomatch;
}
