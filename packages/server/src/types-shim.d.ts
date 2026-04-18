// Minimal ambient module shims so the project typechecks without pulling
// extra @types packages. The runtime is correct; we only need TS to be quiet.

declare module "better-sqlite3" {
  // We use only a tiny subset of the API; type it permissively as `any` so
  // we don't have to maintain a full surface here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Database: any;
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Database {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Database = any;
  }
  export = Database;
}

declare module "ws" {
  // We only reference WebSocket as a structural type in ws-hub.ts.
  export interface WebSocket {
    readyState: number;
    OPEN: number;
    send(data: string | Buffer): void;
    close(): void;
    on(event: "message", cb: (data: Buffer) => void): void;
    on(event: "close", cb: () => void): void;
    on(event: "error", cb: (err: Error) => void): void;
    on(event: string, cb: (...args: unknown[]) => void): void;
  }
}
