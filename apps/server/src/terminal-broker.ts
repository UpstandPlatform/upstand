import { randomUUID } from "node:crypto";
import { hostVerifierForFingerprint } from "@upstand/platform/ssh/host-key";
import { Client, type ClientChannel } from "ssh2";

type TerminalSession = {
  userId: string;
  sessionId: string;
  twoFactorEnabled: boolean;
  host: string;
  port: number;
  username: string;
  privateKey: string;
  hostKeyFingerprint: string;
  command?: string;
  expiresAt: number;
};

export type TerminalSessionIdentity = Pick<
  TerminalSession,
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

type TerminalConnection = {
  client: Client;
  channel: ClientChannel;
};

/** Short-lived, single-use SSH hand-off. Private keys never reach the browser. */
export class TerminalBroker {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly connections = new Map<string, TerminalConnection>();

  create(session: Omit<TerminalSession, "expiresAt">): string {
    const token = randomUUID();
    this.sessions.set(token, { ...session, expiresAt: Date.now() + 60_000 });
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

    const client = new Client();
    await new Promise<void>((resolve, reject) => {
      client
        .once("ready", resolve)
        .once("error", reject)
        .connect({
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
        client.exec(session.command, { pty: true }, callback);
      } else {
        client.shell({ term: "xterm-256color", cols: 120, rows: 32 }, callback);
      }
    });

    this.connections.set(token, { client, channel });
    channel.on("data", (data: Buffer) => onData(new Uint8Array(data)));
    channel.stderr.on("data", (data: Buffer) => onData(new Uint8Array(data)));
    channel.once("close", () => {
      this.close(token);
      onClose("SSH session closed");
    });
    client.once("error", (error: Error) =>
      onClose(`SSH connection error: ${error.message}`),
    );
  }

  async connectForSession(
    userId: string,
    sessionId: string,
    onData: (data: Uint8Array) => void,
    onClose: (message: string) => void,
    validateSession: (identity: TerminalSessionIdentity) => Promise<boolean>,
  ): Promise<string> {
    const pending = [...this.sessions.entries()].find(
      ([, session]) =>
        session.userId === userId &&
        session.sessionId === sessionId &&
        session.expiresAt >= Date.now(),
    );
    if (!pending) throw new Error("Terminal session is not available.");
    await this.connect(pending[0], onData, onClose, validateSession);
    return pending[0];
  }

  write(token: string, data: string): void {
    this.connections.get(token)?.channel.write(data);
  }

  close(token: string): void {
    const connection = this.connections.get(token);
    this.connections.delete(token);
    if (!connection) return;
    connection.channel.close();
    connection.client.end();
  }
}

export const terminalBroker = new TerminalBroker();
