import { assertPhotoKey } from "./keys";
import type { PhotoBytes, PhotoSize, PhotoStore } from "./types";

/** Test/seed fake. Never use this process-local store for production data. */
export class MemoryPhotoStore implements PhotoStore {
  readonly photos = new Map<string, PhotoBytes>();

  put(key: string, photos: PhotoBytes): Promise<void> {
    assertPhotoKey(key);
    this.photos.set(key, { original: photos.original.slice(), thumb: photos.thumb.slice() });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    assertPhotoKey(key);
    this.photos.delete(key);
    return Promise.resolve();
  }

  readUrl(key: string, size: PhotoSize): Promise<string> {
    assertPhotoKey(key);
    return Promise.resolve(`https://photos.example.invalid/${key}/${size}.jpg`);
  }
}
