// The recipes routes share the foods routes' plumbing: the session from the cookie, owner or carer,
// an ApiError response with one no-PII log line per request.
export { foodRoute as recipeRoute } from "@/app/api/spaces/[spaceId]/foods/http";
export { estimateBody as recipeBody } from "@/app/api/spaces/[spaceId]/estimates/http";
