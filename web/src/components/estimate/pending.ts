import type { PhotoEstimate } from "@frejsi/shared/schemas/ai";

// One transient capture, never local/session storage or a URL. Reloading requires a new capture.
export interface PendingEstimate {
  spaceId: string;
  estimate: PhotoEstimate;
  photoDataUrl: string;
}
let pending: PendingEstimate | null = null;
export const setPendingEstimate = (value: PendingEstimate) => {
  pending = value;
};
export const getPendingEstimate = (spaceId: string) =>
  pending?.spaceId === spaceId ? pending : null;
export const clearPendingEstimate = () => {
  pending = null;
};
