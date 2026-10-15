import type { PhotoBytes, PhotoSize, PhotoStore } from "@frejsi/shared/photos/types";

/** Extends the existing store boundary without changing other lanes' PhotoStore consumers. */
export interface ReadablePhotoStore extends PhotoStore {
  read(key: string, size: PhotoSize, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}

/** HTTP read adapter for PhotoStores that supply signed read URLs. No vendor HTTP escapes here. */
export class HttpReadablePhotoStore implements ReadablePhotoStore {
  constructor(
    private readonly store: PhotoStore,
    private readonly request: typeof fetch = fetch,
  ) {}

  put(key: string, photos: PhotoBytes): Promise<void> {
    return this.store.put(key, photos);
  }
  delete(key: string): Promise<void> {
    return this.store.delete(key);
  }
  readUrl(key: string, size: PhotoSize): Promise<string> {
    return this.store.readUrl(key, size);
  }

  async read(
    key: string,
    size: PhotoSize,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    try {
      const url = await this.store.readUrl(key, size);
      const response = await this.request(url, {
        cache: "no-store",
        ...(signal ? { signal } : {}),
      });
      if (!response.ok || !response.body) throw new Error("photo-unavailable");
      return response.body;
    } catch {
      throw new Error("photo-unavailable");
    }
  }
}
