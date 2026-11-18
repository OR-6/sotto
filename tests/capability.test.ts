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
  it('refuses plain objects, script functions, bound functions and proxies', () => {
    const named = (n: string) => ({ [n]: function () {} })[n];
    expect(deviceRuntimeNative({ LanguageModel: { availability: () => 'available' } })).toBe(false);
    expect(deviceRuntimeNative({ LanguageModel: Object.assign(named('LanguageModel'), { availability: Math.max, create: Math.min }) })).toBe(false);
    expect(deviceRuntimeNative({ LanguageModel: Object.assign(Function.prototype.bind.call(Math.max, null), { availability: Math.max, create: Math.min }) })).toBe(false);
    expect(deviceRuntimeNative({ LanguageModel: Object.assign(new Proxy(Math.max, {}), { availability: Math.max, create: Math.min }) })).toBe(false);
    expect(deviceRuntimeNative({})).toBe(false);
  });
  it('a native name is required for each method (Math.max is native but not named LanguageModel)', () => {
    expect(deviceRuntimeNative({ LanguageModel: Math.max })).toBe(false);
  });
});
