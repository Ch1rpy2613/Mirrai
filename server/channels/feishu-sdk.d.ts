/**
 * Ambient types for the Feishu SDK.
 *
 * The SDK is an optional dependency: it is only needed when someone actually
 * connects a Feishu channel. It is loaded dynamically so that an install
 * without it still starts and still works on every other channel.
 *
 * The declarations below cover only the parts Mirrai uses.
 */
declare module "@larksuiteoapi/node-sdk" {
  export interface FeishuClient {
    im: {
      v1: {
        message: {
          create(params: {
            params: { receive_id_type: string };
            data: {
              receive_id: string;
              msg_type: string;
              content: string;
            };
          }): Promise<unknown>;
        };
      };
    };
  }

  export interface FeishuEventDispatcher {
    register(handlers: Record<string, (data: any) => unknown>): FeishuEventDispatcher;
  }

  export interface FeishuWSClient {
    start(config: { eventDispatcher: FeishuEventDispatcher }): Promise<void>;
    close?(): void;
    /** The state of the socket, when the SDK is new enough to have it. */
    getConnectionStatus?(): { state: string; reconnectAttempts?: number };
  }

  export class Client {
    constructor(config: {
      appId: string;
      appSecret: string;
      appType?: unknown;
      domain?: unknown;
    });
    im: FeishuClient["im"];
  }

  export class EventDispatcher {
    register(handlers: Record<string, (data: any) => unknown>): FeishuEventDispatcher;
  }

  export class WSClient {
    constructor(config: { appId: string; appSecret: string });
    start(config: { eventDispatcher: FeishuEventDispatcher }): Promise<void>;
    close?(): void;
    getConnectionStatus?(): { state: string; reconnectAttempts?: number };
  }

  export const AppType: { SelfBuild: unknown; ISV: unknown };
  export const Domain: { Feishu: unknown; Lark: unknown };
}
