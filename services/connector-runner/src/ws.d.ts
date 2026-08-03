declare module "ws" {
  import type { IncomingMessage } from "node:http";
  import type { Duplex } from "node:stream";

  export class WebSocket {
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    readonly readyState: number;
    close(code?: number, reason?: string): void;
    send(data: string | Uint8Array): void;
    on(event: "message", listener: (data: WebSocket.RawData) => void): this;
    on(event: "error" | "close", listener: () => void): this;
  }

  export namespace WebSocket {
    type RawData = Buffer | ArrayBuffer | Buffer[];
  }

  export class WebSocketServer {
    constructor(options: { noServer: true });
    on(
      event: "connection",
      listener: (socket: WebSocket, request: IncomingMessage, session: never) => void,
    ): this;
    emit(event: "connection", socket: WebSocket, request: IncomingMessage, session: unknown): boolean;
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (socket: WebSocket) => void,
    ): void;
  }
}
