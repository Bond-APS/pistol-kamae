import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../src/index';

describe('engine', () => {
  it('公開窓口が読み込める', () => {
    expect(ENGINE_VERSION).toBe('0.1.0');
  });
});
