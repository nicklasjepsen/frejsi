import { z } from "zod";

/**
 * Stable codes; the client translates them in da and en (plan §9). `internal` is a server fault:
 * the plan's list plus this one, so the client never shows validation copy for a 500.
 */
export const ApiErrorCode = z.enum([
  "forbidden",
  "not-found",
  "invite-expired",
  "invite-used",
  "invite-revoked",
  "last-owner",
  "source-bad-credentials",
  "source-unreachable",
  "validation",
  "internal",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiError = z.object({
  error: z.object({ code: ApiErrorCode, message: z.string() }),
});
export type ApiError = z.infer<typeof ApiError>;

/** Thrown by route helpers such as `requireRole`; routes turn it into a response with `toApiError`. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message?: string) {
    super(message ?? code);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

/**
 * The body and status for any thrown value. Unknown errors become a 500 `internal` with a fixed
 * message so that nothing from the request or the stack reaches the client; the client shows its
 * own translation by code.
 */
export function toApiError(error: unknown): { status: number; body: ApiError } {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  return {
    status: 500,
    body: {
      error: {
        code: "internal",
        message: "Something went wrong on our side. Try again in a moment.",
      },
    },
  };
}
