import { Elysia } from "elysia";

//#region src/ElysiaS3Server.d.ts
declare function ElysiaS3Server$1({
  elysiaOptions,
  baseHost,
  iframeAllow,
  metadataProviderClass,
  metadataProviderOptions,
  objectSystemClass,
  objectSystemOptions,
  owner,
  region,
  bucketSystem
}: S3Server.S3ServerOptions): Elysia<"", {
  decorator: {};
  store: {};
  derive: {};
  resolve: {};
}, {
  typebox: {};
  error: {};
}, {
  schema: {};
  standaloneSchema: {};
  macro: {};
  macroFn: {};
  parser: {};
  response: {};
}, {
  "*": {
    [x: string]: {
      body: unknown;
      params: {
        "*": string;
      } & {};
      query: unknown;
      headers: unknown;
      response: {
        200: Response;
        422: {
          type: "validation";
          on: string;
          summary?: string;
          message?: string;
          found?: unknown;
          property?: string;
          expected?: string;
        };
      };
    };
  };
}, {
  derive: {};
  resolve: {};
  schema: {};
  standaloneSchema: {};
  response: {};
}, {
  derive: {};
  resolve: {};
  schema: {};
  standaloneSchema: {};
  response: {};
}>;
//#endregion
//#region src/index.d.ts
type Internal<T> = T & {
  internal?: Record<string, any>;
};
declare class S3Server$1 {
  private _baseHost;
  private _iframeAllow;
  private _metadataProviderClass;
  private _metadataProviderOptions;
  private _objectSystemClass;
  private _objectSystemOptions;
  private _bucketSystem;
  private _owner;
  private _region;
  private _bucketSystems;
  constructor({
    baseHost,
    iframeAllow,
    metadataProviderClass,
    metadataProviderOptions,
    objectSystemClass,
    objectSystemOptions,
    owner,
    region,
    bucketSystem
  }: S3Server$1.S3ServerOptions);
  getErrorResponse(status: number, errorCode: string, message: string, requestId?: string): Response;
  getAccessDeniedResponse(requestId: string): Response;
  getResponse(responseInit: Internal<ResponseInit>, body: string | ReadableStream | ArrayBuffer | undefined): Response;
  authenticateRequest(request: Request): Promise<Response | Internal<ResponseInit & {
    headers: Record<string, string | number>;
  }>>;
  extractBucketName(request: Request, response: Internal<ResponseInit & {
    headers: Record<string, string | number>;
  }>): Promise<Response | Internal<ResponseInit & {
    headers: Record<string, string | number>;
  }>>;
  handleRequest(request: Request): Promise<Response>;
  handleGet(request: Request, responseInit: Internal<ResponseInit & {
    headers: Record<string, string | number>;
  }>, query: Record<string, string>, headers: Record<string, string>): Promise<Response>;
  handleHead(request: Request, responseInit: Internal<ResponseInit & {
    headers: Record<string, string | number>;
  }>): Promise<Response>;
  handlePut(request: Request, responseInit: Internal<ResponseInit & {
    headers: Record<string, string | number>;
  }>, query: Record<string, string>, headers: Record<string, string>): Promise<Response>;
  handlePost(request: Request, responseInit: Internal<ResponseInit & {
    headers: Record<string, string | number>;
  }>, query: Record<string, string>, headers: Record<string, string>): Promise<Response>;
  handleDelete(request: Request, responseInit: Internal<ResponseInit & {
    headers: Record<string, string | number>;
  }>, query: Record<string, string>, headers: Record<string, string>): Promise<Response>;
}
declare const ElysiaS3Server: typeof ElysiaS3Server$1;
//#endregion
export { ElysiaS3Server, S3Server$1 as default };
//# sourceMappingURL=index.d.cts.map