/**
 * Extract error message from any error object.
 * Handles Error instances, strings, and unknown types gracefully.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
