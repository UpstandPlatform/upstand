import { randomUUID } from "node:crypto";
import { hostVerifierForFingerprint } from "@upstand/platform/ssh/host-key";
import { Client, type ClientChannel } from "ssh2";
import { isValidContainerIdentifier } from "./container-ownership";

export type LocalTerminalSessionInput = {
  userId: string;
  sessionId: string;
  twoFactorEnabled: boolean;
  isLocal: true;
  containerId: string;
  initialCols?: number;
  initialRows?: number;
};

export type RemoteTerminalSessionInput = {
  userId: string;
  sessionId: string;
  twoFactorEnabled: boolean;
  isLocal?: false;
  host: string;
  port: number;
  username: string;
  privateKey: string;
  hostKeyFingerprint: string;
  command?: string;
  initialCols?: number;
  initialRows?: number;
};

export type TerminalSessionInput =
  | LocalTerminalSessionInput
  | RemoteTerminalSessionInput;

type BaseTerminalSession = {
  userId: string;
  sessionId: string;
  twoFactorEnabled: boolean;
  expiresAt: number;
};

type LocalTerminalSession = BaseTerminalSession & {
  isLocal: true;
  containerId: string;
  initialCols?: number;
  initialRows?: number;
};

type RemoteTerminalSession = BaseTerminalSession & {
  isLocal?: false;
  host: string;
  port: number;
  username: string;
  privateKey: string;
  hostKeyFingerprint: string;
  command?: string;
  initialCols?: number;
  initialRows?: number;
};

type TerminalSession = LocalTerminalSession | RemoteTerminalSession;

export type TerminalSessionIdentity = Pick<
  BaseTerminalSession,
  "userId" | "sessionId" | "twoFactorEnabled"
>;

export function matchesTerminalSession(
  expected: TerminalSessionIdentity,
  actual: TerminalSessionIdentity,
): boolean {
  return (
    expected.userId === actual.userId &&
    expected.sessionId === actual.sessionId &&
    expected.twoFactorEnabled === actual.twoFactorEnabled
  );
}

type LocalConnection = {
  kind: "local";
  subprocess: Bun.Subprocess;
  terminal: Bun.Terminal;
  alive: boolean;
  closed: boolean;
  ready: boolean;
  readying: boolean;
  pendingWrites: string[];
  pendingWriteBytes: number;
  pendingResize?: { cols: number; rows: number };
  onClose: (message: string) => void;
};

type SshConnection = {
  kind: "ssh";
  client: Client;
  channel: ClientChannel;
  closed: boolean;
  onClose: (message: string) => void;
};

type TerminalConnection = LocalConnection | SshConnection;

const SESSION_TTL_MS = 60_000;
const SESSION_SWEEP_INTERVAL_MS = 30_000;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const MIN_COLS = 10;
const MAX_COLS = 500;
const MIN_ROWS = 5;
const MAX_ROWS = 200;
const MAX_INPUT_BYTES = 64 * 1024;

function normalizeDimension(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function terminalSize(
  cols?: number,
  rows?: number,
): { cols: number; rows: number } {
  return {
    cols: normalizeDimension(cols, DEFAULT_COLS, MIN_COLS, MAX_COLS),
    rows: normalizeDimension(rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS),
  };
}

function dataByteLength(data: string | Uint8Array): number {
  return typeof data === "string"
    ? Buffer.byteLength(data, "utf8")
    : data.byteLength;
}

/** Short-lived, single-use hand-off. Private keys never reach the browser. */
export class TerminalBroker {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly connections = new Map<string, TerminalConnection>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor() {
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const [token, session] of this.sessions) {
        if (session.expiresAt < now) this.sessions.delete(token);
      }
    }, SESSION_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  create(session: TerminalSessionInput): string {
    if (session.isLocal && !isValidContainerIdentifier(session.containerId)) {
      throw new Error("Invalid container identifier.");
    }

    const token = randomUUID();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    if (session.isLocal) {
      this.sessions.set(token, {
        userId: session.userId,
        sessionId: session.sessionId,
        twoFactorEnabled: session.twoFactorEnabled,
        isLocal: true,
        containerId: session.containerId,
        initialCols: session.initialCols,
        initialRows: session.initialRows,
        expiresAt,
      });
    } else {
      this.sessions.set(token, {
        userId: session.userId,
        sessionId: session.sessionId,
        twoFactorEnabled: session.twoFactorEnabled,
        isLocal: false,
        host: session.host,
        port: session.port,
        username: session.username,
        privateKey: session.privateKey,
        hostKeyFingerprint: session.hostKeyFingerprint,
        command: session.command,
        initialCols: session.initialCols,
        initialRows: session.initialRows,
        expiresAt,
      });
    }
    return token;
  }

  async connect(
    token: string,
    onData: (data: Uint8Array) => void,
    onClose: (message: string) => void,
    validateSession: (identity: TerminalSessionIdentity) => Promise<boolean>,
  ): Promise<void> {
    const session = this.sessions.get(token);
    this.sessions.delete(token);
    if (!session || session.expiresAt < Date.now()) {
      throw new Error(
        "Terminal session expired. Open a new terminal and try again.",
      );
    }

    if (
      !(await validateSession({
        userId: session.userId,
        sessionId: session.sessionId,
        twoFactorEnabled: session.twoFactorEnabled,
      }))
    ) {
      throw new Error("Terminal session is no longer valid.");
    }

    let closeNotified = false;
    const notifyClose = (message: string) => {
      if (closeNotified) return;
      closeNotified = true;
      try {
        onClose(message);
      } catch {
        // A disconnected transport must not crash the broker.
      }
    };

    if (session.isLocal) {
      if (typeof Bun === "undefined") {
        throw new Error("Container terminals require the Bun runtime.");
      }

      const { cols, rows } = terminalSize(
        session.initialCols,
        session.initialRows,
      );
      const containerId = session.containerId;
      let triedFallback = false;
      const attach = (shellPath: string) => {
        let connection: LocalConnection | undefined;
        const terminal = new Bun.Terminal({
          name: "xterm-256color",
          cols,
          rows,
          data: (_terminal, data) => {
            if (!connection || connection.closed) return;
            if (!connection.ready && !connection.readying) {
              connection.readying = true;
              queueMicrotask(() => {
                if (!connection || connection.closed || !connection.alive) {
                  return;
                }
                connection.ready = true;
                const pendingWrites = connection.pendingWrites;
                connection.pendingWrites = [];
                connection.pendingWriteBytes = 0;
                const pendingResize = connection.pendingResize;
                connection.pendingResize = undefined;
                if (pendingResize) {
                  try {
                    connection.terminal.resize(
                      pendingResize.cols,
                      pendingResize.rows,
                    );
                  } catch {
                    this.close(
                      token,
                      "Terminal connection is no longer available.",
                    );
                    return;
                  }
                }
                for (const pendingWrite of pendingWrites) {
                  if (
                    connection.closed ||
                    !connection.alive ||
                    connection.terminal.closed
                  ) {
                    break;
                  }
                  try {
                    connection.terminal.write(pendingWrite);
                  } catch {
                    this.close(
                      token,
                      "Terminal connection is no longer available.",
                    );
                    break;
                  }
                }
              });
            }
            try {
              onData(data);
            } catch {
              this.close(token, "Terminal transport closed.");
            }
          },
          exit: () => {
            if (!connection || connection.closed) return;
            queueMicrotask(() => {
              if (
                connection &&
                !connection.closed &&
                this.connections.get(token) === connection &&
                connection.subprocess.exitCode === null
              ) {
                this.close(token, "Interactive shell transport closed.");
              }
            });
          },
        });

        const subprocess = Bun.spawn(
          ["docker", "exec", "-it", containerId, shellPath],
          {
            cwd: process.cwd(),
            env: { ...process.env, TERM: "xterm-256color" },
            terminal,
            windowsHide: true,
            onExit: (_process, exitCode, signal) => {
              if (!connection) return;
              connection.alive = false;
              connection.pendingWrites = [];
              connection.pendingWriteBytes = 0;
              connection.pendingResize = undefined;
              if (this.connections.get(token) !== connection) return;

              if (
                !connection.closed &&
                !triedFallback &&
                (exitCode === 126 || exitCode === 127) &&
                !signal
              ) {
                triedFallback = true;
                this.connections.delete(token);
                connection.closed = true;
                try {
                  connection.terminal.close();
                } catch {
                  // Terminal may already be closed.
                }
                try {
                  attach("/bin/sh");
                } catch {
                  notifyClose(
                    "Unable to start an interactive shell in the container.",
                  );
                }
                return;
              }

              this.connections.delete(token);
              if (!connection.closed) {
                const reason = signal
                  ? `killed by signal ${signal}`
                  : `code ${exitCode ?? 0}`;
                notifyClose(`Interactive shell session closed (${reason}).`);
              }
            },
          },
        );

        connection = {
          kind: "local",
          subprocess,
          terminal,
          alive: true,
          closed: false,
          ready: false,
          readying: false,
          pendingWrites: [],
          pendingWriteBytes: 0,
          onClose: notifyClose,
        };
        this.connections.set(token, connection);
      };

      try {
        attach("/bin/bash");
      } catch {
        throw new Error(
          "Unable to start an interactive shell in the container.",
        );
      }
      return;
    }

    const client = new Client();
    const { cols, rows } = terminalSize(
      session.initialCols,
      session.initialRows,
    );
    const pty = { term: "xterm-256color", cols, rows };

    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          client.removeListener("ready", handleReady);
          client.removeListener("error", handleError);
        };
        const handleReady = () => {
          cleanup();
          resolve();
        };
        const handleError = (error: Error) => {
          cleanup();
          reject(error);
        };
        client.once("ready", handleReady);
        client.once("error", handleError);
        client.connect({
          host: session.host,
          port: session.port,
          username: session.username,
          privateKey: session.privateKey,
          hostHash: "sha256",
          hostVerifier: hostVerifierForFingerprint(session.hostKeyFingerprint),
          readyTimeout: 20_000,
        });
      });

      const channel = await new Promise<ClientChannel>((resolve, reject) => {
        const callback = (error: Error | undefined, stream: ClientChannel) => {
          if (error) reject(error);
          else resolve(stream);
        };
        if (session.command) {
          client.exec(session.command, { pty }, callback);
        } else {
          client.shell(pty, callback);
        }
      });

      const connection: SshConnection = {
        kind: "ssh",
        client,
        channel,
        closed: false,
        onClose: notifyClose,
      };
      this.connections.set(token, connection);
      const emitData = (data: Buffer) => {
        if (connection.closed) return;
        try {
          onData(new Uint8Array(data));
        } catch {
          this.close(token, "Terminal transport closed.");
        }
      };
      channel.on("data", emitData);
      channel.stderr?.on("data", emitData);
      channel.once("close", () => {
        this.finishConnection(token, connection, "SSH session closed.");
      });
      client.once("error", (error: Error) => {
        this.finishConnection(
          token,
          connection,
          `SSH connection error: ${error.message}`,
        );
      });
    } catch (error) {
      client.end();
      throw error;
    }
  }

  async connectForSession(
    userId: string,
    sessionId: string,
    onData: (data: Uint8Array) => void,
    onClose: (message: string) => void,
    validateSession: (identity: TerminalSessionIdentity) => Promise<boolean>,
    requestedToken?: string | null,
  ): Promise<string> {
    let targetToken: string | undefined;
    const normalizedRequestedToken = requestedToken?.trim();

    if (normalizedRequestedToken) {
      const session = this.sessions.get(normalizedRequestedToken);
      if (
        !session ||
        session.userId !== userId ||
        session.sessionId !== sessionId ||
        session.expiresAt < Date.now()
      ) {
        throw new Error("Terminal session is not available.");
      }
      targetToken = normalizedRequestedToken;
    } else {
      const pending = [...this.sessions.entries()].find(
        ([, session]) =>
          session.userId === userId &&
          session.sessionId === sessionId &&
          session.expiresAt >= Date.now(),
      );
      if (!pending) throw new Error("Terminal session is not available.");
      targetToken = pending[0];
    }

    await this.connect(targetToken, onData, onClose, validateSession);
    return targetToken;
  }

  private finishConnection(
    token: string,
    connection: TerminalConnection,
    message: string,
  ): void {
    if (this.connections.get(token) !== connection) return;
    this.connections.delete(token);
    connection.closed = true;
    connection.onClose(message);
    if (connection.kind === "ssh") {
      connection.client.end();
    }
  }

  write(token: string, data: string | Uint8Array): void {
    if (dataByteLength(data) > MAX_INPUT_BYTES) {
      this.close(token, "Terminal input exceeded the allowed message size.");
      return;
    }

    const connection = this.connections.get(token);
    if (!connection || connection.closed) return;

    try {
      if (connection.kind === "local") {
        if (!connection.alive || connection.terminal.closed) return;
        const text =
          typeof data === "string" ? data : new TextDecoder().decode(data);
        if (!connection.ready) {
          const textBytes = Buffer.byteLength(text, "utf8");
          if (connection.pendingWriteBytes + textBytes > MAX_INPUT_BYTES) {
            this.close(
              token,
              "Terminal input exceeded the allowed message size.",
            );
            return;
          }
          connection.pendingWrites.push(text);
          connection.pendingWriteBytes += textBytes;
          return;
        }
        connection.terminal.write(text);
      } else {
        connection.channel.write(data);
      }
    } catch {
      this.close(token, "Terminal connection is no longer available.");
    }
  }

  resize(token: string, cols: number, rows: number): void {
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
    const size = terminalSize(cols, rows);
    const connection = this.connections.get(token);
    if (!connection || connection.closed) return;

    try {
      if (connection.kind === "local") {
        if (connection.alive && !connection.terminal.closed) {
          if (!connection.ready) {
            connection.pendingResize = size;
            return;
          }
          connection.terminal.resize(size.cols, size.rows);
        }
      } else {
        connection.channel.setWindow(size.rows, size.cols, 0, 0);
      }
    } catch {
      this.close(token, "Terminal connection is no longer available.");
    }
  }

  close(token: string, reason?: string): void {
    const connection = this.connections.get(token);
    if (!connection) return;
    this.connections.delete(token);
    connection.closed = true;

    if (connection.kind === "local") {
      connection.alive = false;
      connection.pendingWrites = [];
      connection.pendingWriteBytes = 0;
      connection.pendingResize = undefined;
      try {
        connection.subprocess.kill();
      } catch {
        // Process may already be gone.
      }
      try {
        connection.terminal.close();
      } catch {
        // Terminal may already be closed.
      }
    } else {
      try {
        connection.channel.close();
      } catch {
        // Channel may already be closed.
      }
      connection.client.end();
    }

    if (reason) connection.onClose(reason);
  }

  /** Stop the background sweep timer (useful in tests / graceful shutdown). */
  dispose(): void {
    clearInterval(this.sweepTimer);
  }
}

export const terminalBroker = new TerminalBroker();
