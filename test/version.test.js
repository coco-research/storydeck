import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionInfo } from '../src/version.js';

test('versionInfo reports the app version from package.json', () => {
  delete process.env.STORYDECK_APP_VERSION;
  const v = versionInfo();
  assert.equal(typeof v.appVersion, 'string');
  assert.match(v.appVersion, /^\d+\.\d+\.\d+/);
  assert.equal(typeof v.contentVersion, 'number');
});

test('versionInfo honors STORYDECK_APP_VERSION and STORYDECK_CONTENT_SOURCE overrides', () => {
  process.env.STORYDECK_APP_VERSION = '9.9.9';
  process.env.STORYDECK_CONTENT_SOURCE = 'overlay';
  try {
    const v = versionInfo();
    assert.equal(v.appVersion, '9.9.9');
    assert.equal(v.source, 'overlay');
  } finally {
    delete process.env.STORYDECK_APP_VERSION;
    delete process.env.STORYDECK_CONTENT_SOURCE;
  }
});

test('versionInfo defaults source to bundled', () => {
  delete process.env.STORYDECK_CONTENT_SOURCE;
  assert.equal(versionInfo().source, 'bundled');
});
