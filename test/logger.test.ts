import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger, serializeError } from "../src/logger.js";

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("info/warn write one JSON line to stdout with level/scope/message", () => {
    logger.info("poller", "polling started", { contractCount: 2 });

    expect(logSpy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({
      level: "info",
      scope: "poller",
      message: "polling started",
      meta: { contractCount: 2 },
    });
    expect(typeof parsed.time).toBe("string");
  });

  it("error writes to stderr, not stdout", () => {
    logger.error("api", "unhandled error");

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(logSpy).not.toHaveBeenCalled();
    const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ level: "error", scope: "api", message: "unhandled error" });
  });

  it("omits the meta field entirely when none is given", () => {
    logger.info("index", "shutdown complete");
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed).not.toHaveProperty("meta");
  });

  it("serializeError extracts message/stack from a real Error", () => {
    const err = new Error("boom");
    const meta = serializeError(err);
    expect(meta.message).toBe("boom");
    expect(typeof meta.stack).toBe("string");
  });

  it("serializeError wraps a non-Error value instead of losing it", () => {
    expect(serializeError("plain string")).toEqual({ value: "plain string" });
    expect(serializeError(42)).toEqual({ value: 42 });
  });
});
