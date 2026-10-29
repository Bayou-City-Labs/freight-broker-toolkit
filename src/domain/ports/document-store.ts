/**
 * Where generated documents (rate confirmations, BOLs) actually live.
 *
 * Every generated document is an audit artifact, so stored objects are
 * immutable and content-addressed: the hash recorded against the Document row
 * must match the bytes that come back out, years later.
 *
 * The local filesystem adapter backs development. An S3 adapter replaces it
 * for deployed environments without anything in the domain changing.
 */
export interface StoredObject {
  /** Path within the store, stable for the life of the document. */
  readonly key: string;
  /** Lowercase hex SHA-256 of the stored bytes. */
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly contentType: string;
}

export interface PutObject {
  readonly key: string;
  readonly body: Uint8Array;
  readonly contentType: string;
}

export interface DocumentStore {
  /**
   * Writes bytes at `key`. Implementations must reject a write to a key that
   * already holds different bytes — documents are immutable once generated.
   */
  put(object: PutObject): Promise<StoredObject>;

  get(key: string): Promise<Uint8Array>;

  /** Time-limited URL for handing a document to a browser. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;

  exists(key: string): Promise<boolean>;
}
