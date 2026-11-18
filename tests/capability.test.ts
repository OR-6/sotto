import { describe, expect, it } from 'vitest';
import { assertDeviceRuntime, deviceRuntimeNative, deviceRuntimePresent, DeviceRuntimeMissingError } from '../src/ai/capability';

describe('device runtime pre-check', () => {
  it('is false without a LanguageModel global', () => {
    expect(deviceRuntimePresent({})).toBe(false);
    expect(() => assertDeviceRuntime({})).toThrow(DeviceRuntimeMissingError);
  });
  it('is false when LanguageModel has no availability function', () => {
    expect(deviceRuntimePresent({ LanguageModel: {} })).toBe(false);
    expect(deviceRuntimePresent({ LanguageModel: true })).toBe(false);
  });
  it('is true when LanguageModel.availability is a function', () => {
    expect(deviceRuntimePresent({ LanguageModel: { availability: () => 'available' } })).toBe(true);
    expect(() => assertDeviceRuntime({ LanguageModel: { availability: () => 'x' } })).not.toThrow();
  });
});

describe('native LanguageModel check', () => {
  it('refuses a plain object or a script function, accepts a native one', () => {
    expect(deviceRuntimeNative({ LanguageModel: { availability: () => 'available' } })).toBe(false);
    expect(deviceRuntimeNative({ LanguageModel: function LanguageModel() {} })).toBe(false);
    expect(deviceRuntimeNative({ LanguageModel: Math.max })).toBe(true);
    expect(deviceRuntimeNative({})).toBe(false);
  });
});
