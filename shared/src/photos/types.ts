export type PhotoSize = "original" | "thumb";
export interface PhotoBytes {
  original: Uint8Array;
  thumb: Uint8Array;
}

/** Implementations receive processed JPEGs only. Space writes and events belong to services. */
export interface PhotoStore {
  put(key: string, photos: PhotoBytes): Promise<void>;
  delete(key: string): Promise<void>;
  readUrl(key: string, size: PhotoSize): Promise<string>;
}
