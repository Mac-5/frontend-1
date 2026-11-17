/**
 * Vault product telemetry — src/lib/telemetry/vaults.ts
 *
 * Typed `track(event)` module for the depositor funnel. Event schema is
 * documented in docs/vault-telemetry.md.
 *
 * Guarantees:
 *  - No wallet addresses, no free-text input, no tx ids. Only coarse,
 *    enumerated properties (vault id, strategy, asset, network, epoch,
 *    base-unit amounts bucketed, error code, flag exposure state).
 *  - Respects the app-wide opt-out (`zenith_telemetry_opt_out=1` in
 *    localStorage) and `navigator.doNotTrack`.
 *  - Never throws: safe when the vaults flag is off, when the backend is
 *    unreachable, and during SSR.
 */

import { captureMessage } from "../monitoring";

export type VaultTelemetryEvent =
  | "vault_page_view"
  | "vault_view"
  | "vault_filter_used"
  | "vault_deposit_preview_shown"
  | "vault_deposit_submitted"
  | "vault_deposit_confirmed"
  | "vault_deposit_failed"
  | "vault_withdrawal_submitted"
  | "vault_withdrawal_confirmed"
  | "vault_withdrawal_failed"
  | "vault_redemption_queued"
  | "vault_capacity_state";

export type VaultTelemetryErrorCode =
  | "policy_rejected"
  | "capacity_changed"
  | "backend_unreachable"
  | "unknown";

export type VaultCapacityState = "open" | "queued" | "waitlist" | "full" | "stale";

export interface VaultTelemetryProps {
  /** Stable vault id (never a wallet address). */
  vaultId?: string;
  strategy?: string;
  asset?: string;
  network?: string;
  epoch?: number;
  /** Amount in base units, bucketed to avoid fingerprinting. */
  amountBucket?: string;
  /** Which filter dimension changed, and to which enumerated value. */
  filter?: string;
  filterValue?: string;
  errorCode?: VaultTelemetryErrorCode;
  /** Whether the `vaults` flag was on when the event fired. */
  flagEnabled: boolean;
  capacityState?: VaultCapacityState;
  /** Where the event originated. */
  surface?: "index" | "detail" | "adapter";
}

const OPT_OUT_KEY = "zenith_telemetry_opt_out";

/** Bucket a base-unit amount so raw values never leave the client. */
export function bucketAmount(amount: number | null | undefined): string | undefined {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || amount <= 0) return undefined;
  if (amount < 100) return "<100";
  if (amount < 1_000) return "100-1k";
  if (amount < 10_000) return "1k-10k";
  if (amount < 100_000) return "10k-100k";
  return ">=100k";
}

function optedOut(): boolean {
  if (typeof window === "undefined") return true;
  try {
    if (window.localStorage.getItem(OPT_OUT_KEY) === "1") return true;
  } catch {
    // Storage blocked — treat as opted out (fail closed).
    return true;
  }
  const dnt = (navigator as Navigator & { doNotTrack?: string | null }).doNotTrack;
  return dnt === "1";
}

/** Persist the user's telemetry choice (shared with the rest of the app). */
export function setTelemetryOptOut(optOut: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (optOut) window.localStorage.setItem(OPT_OUT_KEY, "1");
    else window.localStorage.removeItem(OPT_OUT_KEY);
}

/**
 * Emit a vault funnel event. Fire-and-forget; never throws.
 * No-ops when the vaults flag is off, when the user opted out, or on the server.
 */
export function track(event: VaultTelemetryEvent, props: VaultTelemetryProps): void {
  try {
    if (!props.flagEnabled) return;
    if (optedOut()) return;
    const payload = {
      event,
      vault_id: props.vaultId,
      strategy: props.strategy,
      asset: props.asset,
      network: props.network,
      epoch: props.epoch,
      amount_bucket: props.amountBucket,
      filter: props.filter,
      filter_value: props.filterValue,
      error_code: props.errorCode,
      capacity_state: props.capacityState,
      surface: props.surface,
      flag_enabled: props.flagEnabled,
    };
    // Transport is the monitoring facade; it no-ops when the backend is
    // unreachable, so a failed send can never break the funnel.
    void captureMessage(`telemetry:${event} ${JSON.stringify(payload)}`, "info");
  } catch {
    // Telemetry must never break the product.
  }
}
