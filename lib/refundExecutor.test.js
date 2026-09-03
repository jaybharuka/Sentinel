import { describe, it, expect, vi, beforeEach } from "vitest";

const refundMock = vi.fn();

vi.mock("razorpay", () => ({
  default: vi.fn().mockImplementation(function RazorpayMock() {
    this.payments = { refund: refundMock };
  }),
}));

beforeEach(() => {
  vi.resetModules();
  refundMock.mockReset();
  process.env.RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = "rzp_test_secret";
});

describe("executeRefund - success path", () => {
  it("returns success with refundId and status on a successful Razorpay call", async () => {
    refundMock.mockResolvedValue({ id: "rfnd_abc123", status: "processed" });
    const { executeRefund } = await import("./refundExecutor");

    const result = await executeRefund("pay_xyz", 10000);

    expect(result).toEqual({ success: true, refundId: "rfnd_abc123", status: "processed" });
    expect(refundMock).toHaveBeenCalledWith("pay_xyz", { amount: 10000 });
  });
});

describe("executeRefund - failure paths never throw", () => {
  it("returns a structured failure when Razorpay throws an error with a description", async () => {
    refundMock.mockRejectedValue({ error: { description: "Payment already refunded" } });
    const { executeRefund } = await import("./refundExecutor");

    const result = await executeRefund("pay_xyz", 10000);

    expect(result).toEqual({ success: false, error: "Payment already refunded" });
  });

  it("returns a structured failure using err.message when no description is present", async () => {
    refundMock.mockRejectedValue(new Error("network timeout"));
    const { executeRefund } = await import("./refundExecutor");

    const result = await executeRefund("pay_xyz", 10000);

    expect(result.success).toBe(false);
    expect(result.error).toBe("network timeout");
  });

  it("falls back to a status-code message for a bare statusCode error with no body", async () => {
    refundMock.mockRejectedValue({ statusCode: 404, error: undefined });
    const { executeRefund } = await import("./refundExecutor");

    const result = await executeRefund("pay_xyz", 10000);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Razorpay API error (status 404)");
  });

  it("falls back to a JSON dump when the error has no description, message, or statusCode", async () => {
    refundMock.mockRejectedValue({ weird: "shape" });
    const { executeRefund } = await import("./refundExecutor");

    const result = await executeRefund("pay_xyz", 10000);

    expect(result.success).toBe(false);
    expect(result.error).toBe(JSON.stringify({ weird: "shape" }));
  });

  it("never throws, even when Razorpay credentials are not configured", async () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    const { executeRefund } = await import("./refundExecutor");

    await expect(executeRefund("pay_xyz", 10000)).resolves.toMatchObject({ success: false });
  });
});
