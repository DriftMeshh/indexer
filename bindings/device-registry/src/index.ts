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
  3: {message:"DeviceAlreadyRegistered"},
  4: {message:"DeviceNotFound"},
  5: {message:"NotOwnerOrAdmin"}
}


export interface Device {
  active: boolean;
  device_type: string;
  lat: i32;
  lon: i32;
  owner: string;
  registered_at: u64;
}

export interface Client {
  /**
   * Construct and simulate a is_active transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Cheap existence+status check other contracts cross-call before
   * trusting a device's submission.
   */
  is_active: ({device}: {device: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_device transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_device: ({device}: {device: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Device>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin}: {admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a register_device transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * A device registers itself — it must sign this call with its own
   * keypair, proving it controls the address it will later sign
   * readings with. `lat`/`lon` are coarse degrees * 1e4 (fixed-point,
   * since Soroban has no floats), used by the validator to bucket
   * nearby devices for outlier comparison.
   */
  register_device: ({device, owner, device_type, lat, lon}: {device: string, owner: string, device_type: string, lat: i32, lon: i32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a deactivate_device transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The device's owner (or the registry admin) can deactivate it —
   * e.g. decommissioned hardware or a device caught submitting bad data.
   */
  deactivate_device: ({device, caller}: {device: string, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABQAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAXRGV2aWNlQWxyZWFkeVJlZ2lzdGVyZWQAAAAAAwAAAAAAAAAORGV2aWNlTm90Rm91bmQAAAAAAAQAAAAAAAAAD05vdE93bmVyT3JBZG1pbgAAAAAF",
        "AAAAAQAAAAAAAAAAAAAABkRldmljZQAAAAAABgAAAAAAAAAGYWN0aXZlAAAAAAABAAAAAAAAAAtkZXZpY2VfdHlwZQAAAAARAAAAAAAAAANsYXQAAAAABQAAAAAAAAADbG9uAAAAAAUAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAANcmVnaXN0ZXJlZF9hdAAAAAAAAAY=",
        "AAAAAAAAAF5DaGVhcCBleGlzdGVuY2Urc3RhdHVzIGNoZWNrIG90aGVyIGNvbnRyYWN0cyBjcm9zcy1jYWxsIGJlZm9yZQp0cnVzdGluZyBhIGRldmljZSdzIHN1Ym1pc3Npb24uAAAAAAAJaXNfYWN0aXZlAAAAAAAAAQAAAAAAAAAGZGV2aWNlAAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAKZ2V0X2RldmljZQAAAAAAAQAAAAAAAAAGZGV2aWNlAAAAAAATAAAAAQAAA+kAAAfQAAAABkRldmljZQAAAAAAAw==",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAASRBIGRldmljZSByZWdpc3RlcnMgaXRzZWxmIOKAlCBpdCBtdXN0IHNpZ24gdGhpcyBjYWxsIHdpdGggaXRzIG93bgprZXlwYWlyLCBwcm92aW5nIGl0IGNvbnRyb2xzIHRoZSBhZGRyZXNzIGl0IHdpbGwgbGF0ZXIgc2lnbgpyZWFkaW5ncyB3aXRoLiBgbGF0YC9gbG9uYCBhcmUgY29hcnNlIGRlZ3JlZXMgKiAxZTQgKGZpeGVkLXBvaW50LApzaW5jZSBTb3JvYmFuIGhhcyBubyBmbG9hdHMpLCB1c2VkIGJ5IHRoZSB2YWxpZGF0b3IgdG8gYnVja2V0Cm5lYXJieSBkZXZpY2VzIGZvciBvdXRsaWVyIGNvbXBhcmlzb24uAAAAD3JlZ2lzdGVyX2RldmljZQAAAAAFAAAAAAAAAAZkZXZpY2UAAAAAABMAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAALZGV2aWNlX3R5cGUAAAAAEQAAAAAAAAADbGF0AAAAAAUAAAAAAAAAA2xvbgAAAAAFAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAIVUaGUgZGV2aWNlJ3Mgb3duZXIgKG9yIHRoZSByZWdpc3RyeSBhZG1pbikgY2FuIGRlYWN0aXZhdGUgaXQg4oCUCmUuZy4gZGVjb21taXNzaW9uZWQgaGFyZHdhcmUgb3IgYSBkZXZpY2UgY2F1Z2h0IHN1Ym1pdHRpbmcgYmFkIGRhdGEuAAAAAAAAEWRlYWN0aXZhdGVfZGV2aWNlAAAAAAAAAgAAAAAAAAAGZGV2aWNlAAAAAAATAAAAAAAAAAZjYWxsZXIAAAAAABMAAAABAAAD6QAAAAIAAAAD" ]),
      options
    )
  }
  public readonly fromJSON = {
    is_active: this.txFromJSON<boolean>,
        get_device: this.txFromJSON<Result<Device>>,
        initialize: this.txFromJSON<Result<void>>,
        register_device: this.txFromJSON<Result<void>>,
        deactivate_device: this.txFromJSON<Result<void>>
  }
}