import { describe, expect, it } from 'vitest';
import { assertDeviceRuntime, deviceRuntimePresent, DeviceRuntimeMissingError } from '../src/ai/capability';

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
