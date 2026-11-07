import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const Errors = {
  1: {message:"NotInitialized"},
  2: {message:"AlreadyInitialized"},
  3: {message:"AlreadyClaimed"},
  4: {message:"NothingToClaim"},
  /**
   * The epoch's window hasn't closed yet, so its total submission count
   * isn't final and payouts can't be computed fairly. Claim again after
   * the epoch ends.
   */
  5: {message:"EpochNotFinal"},
  /**
   * The contract has been paused by the admin. All claim calls are
   * rejected until the admin calls unpause().
   */
  6: {message:"ContractPaused"}
}


export interface Client {
  /**
   * Construct and simulate a claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * A device claims its proportional share of an epoch's pool. The epoch
   * must be final (its total is frozen), and each device can claim once
   * per epoch. The first claim for a finalized epoch snapshots the pool;
   * `payout = epoch_pool * device_count / total`, with the live balance
   * used only as a defensive cap that never triggers in normal flow.
   */
  claim: ({device, epoch}: {device: string, epoch: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin pauses all claim operations. Useful during an emergency or
   * while a dispute is being investigated. Idempotent: calling pause
   * when already paused has no effect.
   */
  pause: ({admin_caller}: {admin_caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a unpause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin unpauses the contract, re-enabling claims. Idempotent.
   */
  unpause: ({admin_caller}: {admin_caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a is_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a epoch_pool transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The one-time pool snapshot for an epoch (0 if no one has claimed for
   * it yet). Useful for inspecting what a finalized epoch will split.
   */
  epoch_pool: ({epoch}: {epoch: u32}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin, validator, reward_token}: {admin: string, validator: string, reward_token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a has_claimed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  has_claimed: ({device, epoch}: {device: string, epoch: u32}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a pool_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * How much reward token this contract currently holds — i.e. what's
   * available to be paid out (across all not-yet-claimed epochs).
   */
  pool_balance: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABgAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAOQWxyZWFkeUNsYWltZWQAAAAAAAMAAAAAAAAADk5vdGhpbmdUb0NsYWltAAAAAAAEAAAAl1RoZSBlcG9jaCdzIHdpbmRvdyBoYXNuJ3QgY2xvc2VkIHlldCwgc28gaXRzIHRvdGFsIHN1Ym1pc3Npb24gY291bnQKaXNuJ3QgZmluYWwgYW5kIHBheW91dHMgY2FuJ3QgYmUgY29tcHV0ZWQgZmFpcmx5LiBDbGFpbSBhZ2FpbiBhZnRlcgp0aGUgZXBvY2ggZW5kcy4AAAAADUVwb2NoTm90RmluYWwAAAAAAAAFAAAAaFRoZSBjb250cmFjdCBoYXMgYmVlbiBwYXVzZWQgYnkgdGhlIGFkbWluLiBBbGwgY2xhaW0gY2FsbHMgYXJlCnJlamVjdGVkIHVudGlsIHRoZSBhZG1pbiBjYWxscyB1bnBhdXNlKCkuAAAADkNvbnRyYWN0UGF1c2VkAAAAAAAG",
        "AAAABQAAAHxFbWl0dGVkIHdoZW4gYSBkZXZpY2Ugc3VjY2Vzc2Z1bGx5IGNsYWltcyBpdHMgcGF5b3V0IGZvciBhbiBlcG9jaC4KVG9waWNzOiBbImNsYWltZWQiLCBkZXZpY2VfYWRkcmVzc10KRGF0YTogKGVwb2NoLCBwYXlvdXQpAAAAAAAAAAdDbGFpbWVkAAAAAAEAAAAHY2xhaW1lZAAAAAADAAAAAAAAAAZkZXZpY2UAAAAAABMAAAABAAAAAAAAAAVlcG9jaAAAAAAAAAQAAAAAAAAAAAAAAAZwYXlvdXQAAAAAAAsAAAAAAAAAAg==",
        "AAAAAAAAAVJBIGRldmljZSBjbGFpbXMgaXRzIHByb3BvcnRpb25hbCBzaGFyZSBvZiBhbiBlcG9jaCdzIHBvb2wuIFRoZSBlcG9jaAptdXN0IGJlIGZpbmFsIChpdHMgdG90YWwgaXMgZnJvemVuKSwgYW5kIGVhY2ggZGV2aWNlIGNhbiBjbGFpbSBvbmNlCnBlciBlcG9jaC4gVGhlIGZpcnN0IGNsYWltIGZvciBhIGZpbmFsaXplZCBlcG9jaCBzbmFwc2hvdHMgdGhlIHBvb2w7CmBwYXlvdXQgPSBlcG9jaF9wb29sICogZGV2aWNlX2NvdW50IC8gdG90YWxgLCB3aXRoIHRoZSBsaXZlIGJhbGFuY2UKdXNlZCBvbmx5IGFzIGEgZGVmZW5zaXZlIGNhcCB0aGF0IG5ldmVyIHRyaWdnZXJzIGluIG5vcm1hbCBmbG93LgAAAAAABWNsYWltAAAAAAAAAgAAAAAAAAAGZGV2aWNlAAAAAAATAAAAAAAAAAVlcG9jaAAAAAAAAAQAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAKRBZG1pbiBwYXVzZXMgYWxsIGNsYWltIG9wZXJhdGlvbnMuIFVzZWZ1bCBkdXJpbmcgYW4gZW1lcmdlbmN5IG9yCndoaWxlIGEgZGlzcHV0ZSBpcyBiZWluZyBpbnZlc3RpZ2F0ZWQuIElkZW1wb3RlbnQ6IGNhbGxpbmcgcGF1c2UKd2hlbiBhbHJlYWR5IHBhdXNlZCBoYXMgbm8gZWZmZWN0LgAAAAVwYXVzZQAAAAAAAAEAAAAAAAAADGFkbWluX2NhbGxlcgAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAADxBZG1pbiB1bnBhdXNlcyB0aGUgY29udHJhY3QsIHJlLWVuYWJsaW5nIGNsYWltcy4gSWRlbXBvdGVudC4AAAAHdW5wYXVzZQAAAAABAAAAAAAAAAxhZG1pbl9jYWxsZXIAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAJaXNfcGF1c2VkAAAAAAAAAAAAAAEAAAAB",
        "AAAAAAAAAIZUaGUgb25lLXRpbWUgcG9vbCBzbmFwc2hvdCBmb3IgYW4gZXBvY2ggKDAgaWYgbm8gb25lIGhhcyBjbGFpbWVkIGZvcgppdCB5ZXQpLiBVc2VmdWwgZm9yIGluc3BlY3Rpbmcgd2hhdCBhIGZpbmFsaXplZCBlcG9jaCB3aWxsIHNwbGl0LgAAAAAACmVwb2NoX3Bvb2wAAAAAAAEAAAAAAAAABWVwb2NoAAAAAAAABAAAAAEAAAAL",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAl2YWxpZGF0b3IAAAAAAAATAAAAAAAAAAxyZXdhcmRfdG9rZW4AAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAALaGFzX2NsYWltZWQAAAAAAgAAAAAAAAAGZGV2aWNlAAAAAAATAAAAAAAAAAVlcG9jaAAAAAAAAAQAAAABAAAAAQ==",
        "AAAAAAAAAIFIb3cgbXVjaCByZXdhcmQgdG9rZW4gdGhpcyBjb250cmFjdCBjdXJyZW50bHkgaG9sZHMg4oCUIGkuZS4gd2hhdCdzCmF2YWlsYWJsZSB0byBiZSBwYWlkIG91dCAoYWNyb3NzIGFsbCBub3QteWV0LWNsYWltZWQgZXBvY2hzKS4AAAAAAAAMcG9vbF9iYWxhbmNlAAAAAAAAAAEAAAAL" ]),
      options
    )
  }
  public readonly fromJSON = {
    claim: this.txFromJSON<Result<i128>>,
        pause: this.txFromJSON<Result<void>>,
        unpause: this.txFromJSON<Result<void>>,
        is_paused: this.txFromJSON<boolean>,
        epoch_pool: this.txFromJSON<i128>,
        initialize: this.txFromJSON<Result<void>>,
        has_claimed: this.txFromJSON<boolean>,
        pool_balance: this.txFromJSON<i128>
  }
}