import {
  BlobServiceClient,
  BlobSASPermissions,
  SASProtocol,
  type StoragePipelineOptions,
} from "@azure/storage-blob";
import { assertPhotoKey } from "./keys";
import type { PhotoBytes, PhotoSize, PhotoStore } from "./types";

export type PhotoHttpClient = NonNullable<StoragePipelineOptions["httpClient"]>;
interface Options {
  now?: () => Date;
  httpClient?: PhotoHttpClient;
}

/** The only Blob SDK boundary. Credentials and SDK errors never leave this adapter. */
export class BlobPhotoStore implements PhotoStore {
  private readonly container;
  private readonly now;

  constructor(connectionString: string, options: Options = {}) {
    try {
      this.container = BlobServiceClient.fromConnectionString(connectionString, {
        ...(options.httpClient ? { httpClient: options.httpClient } : {}),
      }).getContainerClient("photos");
    } catch {
      throw new Error("photo-unavailable");
    }
    this.now = options.now ?? (() => new Date());
  }

  async put(key: string, photos: PhotoBytes): Promise<void> {
    assertPhotoKey(key);
    try {
      for (const size of ["original", "thumb"] as const) {
        await this.container.getBlockBlobClient(`${key}/${size}.jpg`).uploadData(photos[size], {
          blobHTTPHeaders: {
            blobContentType: "image/jpeg",
            blobCacheControl: "private, max-age=3600",
          },
        });
      }
    } catch {
      // Clean up an incomplete pair; never log the key, bytes, signed URL or SDK error.
      await this.delete(key).catch(() => undefined);
      throw new Error("photo-unavailable");
    }
  }

  async delete(key: string): Promise<void> {
    assertPhotoKey(key);
    const outcomes = await Promise.allSettled(
      (["original", "thumb"] as const).map((size) =>
        this.container.getBlockBlobClient(`${key}/${size}.jpg`).deleteIfExists(),
      ),
    );
    if (outcomes.some((result) => result.status === "rejected"))
      throw new Error("photo-unavailable");
  }

  async readUrl(key: string, size: PhotoSize): Promise<string> {
    assertPhotoKey(key);
    const expiresOn = new Date(
      Math.floor(this.now().getTime() / 3_600_000) * 3_600_000 + 7_200_000,
    );
    const blob = this.container.getBlockBlobClient(`${key}/${size}.jpg`);
    try {
      return await blob.generateSasUrl({
        permissions: BlobSASPermissions.parse("r"),
        expiresOn,
        // Local Azurite uses HTTP; production uses HTTPS exclusively.
        protocol: blob.url.startsWith("https:") ? SASProtocol.Https : SASProtocol.HttpsAndHttp,
      });
    } catch {
      throw new Error("photo-unavailable");
    }
  }
}

/** Photo services return 503 when no store is configured; the rest of the app still works. */
export function createPhotoStoreFromEnv(
  env: Record<string, string | undefined> = process.env,
): PhotoStore | null {
  return env.BLOB_CONNECTION_STRING ? new BlobPhotoStore(env.BLOB_CONNECTION_STRING) : null;
}
