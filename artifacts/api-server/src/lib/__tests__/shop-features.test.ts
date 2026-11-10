import { describe, it, expect } from "vitest";

describe("Shop Dynamic Pricing and Limited Stock Calculations", () => {
  it("calculates discount percentage correctly", () => {
    const originalPrice = 25000;
    const sellingPrice = 15000;
    const discount = Math.round(((originalPrice - sellingPrice) / originalPrice) * 100);
    expect(discount).toBe(40);
  });

  it("handles no discount when selling price equals original price", () => {
    const originalPrice = 20000;
    const sellingPrice = 20000;
    const discount = Math.round(((originalPrice - sellingPrice) / originalPrice) * 100);
    expect(discount).toBe(0);
  });

  it("validates that selling price cannot exceed original price for discounts", () => {
    const originalPrice = 10000;
    const sellingPrice = 15000;
    const isInvalid = sellingPrice > originalPrice;
    expect(isInvalid).toBe(true);
  });

  it("validates limited stock bounds between 1 and 100", () => {
    const isValidStock = (val: number) => val >= 1 && val <= 100;
    expect(isValidStock(10)).toBe(true);
    expect(isValidStock(1)).toBe(true);
    expect(isValidStock(100)).toBe(true);
    expect(isValidStock(0)).toBe(false);
    expect(isValidStock(101)).toBe(false);
  });
});
