/**
 * Single source of truth for the per-service deploy status vocabulary.
 *
 * A `service_deployment` row's `status` uses the canonical deploy vocab
 * (`success | failure | skipped | cancelled | indeterminate | pending`); older
 * and live-runtime paths also emit `running | failed | deploying | building`.
 * Several consumers classify or re-map it — the deployment-status rollup, the
 * per-service container/observability endpoint, and the dashboard badges. Keep
 * the vocabulary and its mappings HERE so those consumers can't drift apart
 * (which is exactly what caused a successfully-deployed service to render as
 * "Stopped" when one path started writing `success` and another still expected
 * `running`).
 */

/** Statuses that mean the service came up (canonical + legacy live vocab). */
const SERVICE_SUCCESS_STATUSES = new Set(["success", "running", "ready"]);
/** Statuses that mean the service failed or was cancelled. */
const SERVICE_FAILURE_STATUSES = new Set(["failure", "failed", "cancelled"]);
/** Statuses that mean the service is still settling / in flight. */
const SERVICE_IN_FLIGHT_STATUSES = new Set([
  "indeterminate",
  "deploying",
  "building",
  "pending",
]);

export function isServiceSuccessStatus(status: string | null | undefined): boolean {
  return status != null && SERVICE_SUCCESS_STATUSES.has(status);
}

export function isServiceFailureStatus(status: string | null | undefined): boolean {
  return status != null && SERVICE_FAILURE_STATUSES.has(status);
}

/** Live-ish container/observability state a service_deployment status maps to. */
export type ServiceContainerState = "running" | "failed" | "starting" | "stopped";

export function serviceStatusToContainerState(
  status: string | null | undefined,
): ServiceContainerState {
  if (isServiceSuccessStatus(status)) return "running";
  if (isServiceFailureStatus(status)) return "failed";
  if (status != null && SERVICE_IN_FLIGHT_STATUSES.has(status)) return "starting";
  return "stopped"; // skipped / missing / unknown
}
