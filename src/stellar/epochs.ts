import { Client as SubmissionValidatorClient } from "submission-validator";
import { Client as PaymentStreamerClient } from "payment-streamer";

export interface EpochStatus {
  epoch: number;
  isFinal: boolean;
  totalSubmissions: number;
  /** Stringified i128 stroops — 0 until the epoch's first claim snapshots it. */
  epochPool: string;
}

/**
 * Reads an epoch's live status directly from submission-validator and
 * payment-streamer — these are current contract state, not something the
 * poller necessarily has an event for yet (the current, still-open epoch
 * has no "finalized" event to ingest). Read-only simulated calls, no
 * signing required. Returns null if either contract ID isn't configured
 * or a read fails; this is best-effort, matching registry.ts's pattern.
 */
export async function fetchEpochStatus(
  rpcUrl: string,
  networkPassphrase: string,
  submissionValidatorContractId: string | undefined,
  paymentStreamerContractId: string | undefined,
  epoch: number,
): Promise<EpochStatus | null> {
  if (!submissionValidatorContractId || !paymentStreamerContractId) return null;

  try {
    const validator = new SubmissionValidatorClient({
      contractId: submissionValidatorContractId,
      networkPassphrase,
      rpcUrl,
    });
    const streamer = new PaymentStreamerClient({
      contractId: paymentStreamerContractId,
      networkPassphrase,
      rpcUrl,
    });

    const [isFinalTx, totalTx, poolTx] = await Promise.all([
      validator.is_epoch_final({ epoch }),
      validator.get_total_submissions({ epoch }),
      streamer.epoch_pool({ epoch }),
    ]);

    return {
      epoch,
      isFinal: isFinalTx.result,
      totalSubmissions: totalTx.result,
      epochPool: poolTx.result.toString(),
    };
  } catch (err) {
    console.warn(`[epochs] failed to read epoch ${epoch} status:`, err);
    return null;
  }
}
