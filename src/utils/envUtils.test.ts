import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert";
import { getApiUrl } from "./envUtils.js";

describe("getApiUrl", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.CODEATLAS_API_URL;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CODEATLAS_API_URL;
    else process.env.CODEATLAS_API_URL = original;
  });

  it("throws when CODEATLAS_API_URL is unset", () => {
    delete process.env.CODEATLAS_API_URL;
    assert.throws(() => getApiUrl(), /CODEATLAS_API_URL environment variable is not set/);
  });

  it("throws when CODEATLAS_API_URL is empty or whitespace", () => {
    process.env.CODEATLAS_API_URL = "";
    assert.throws(() => getApiUrl(), /CODEATLAS_API_URL environment variable is not set/);
    process.env.CODEATLAS_API_URL = "   ";
    assert.throws(() => getApiUrl(), /CODEATLAS_API_URL environment variable is not set/);
  });

  it("rejects malformed and non-network API URLs", () => {
    process.env.CODEATLAS_API_URL = "not a URL";
    assert.throws(() => getApiUrl(), /must be a valid HTTPS URL or local HTTP URL/);
    process.env.CODEATLAS_API_URL = "file:///etc/passwd";
    assert.throws(() => getApiUrl(), /must be a valid HTTPS URL or local HTTP URL/);
    process.env.CODEATLAS_API_URL = "ftp://example.test";
    assert.throws(() => getApiUrl(), /must be a valid HTTPS URL or local HTTP URL/);
  });

  it("rejects non-loopback HTTP API URLs", () => {
    process.env.CODEATLAS_API_URL = "http://example.com";
    assert.throws(() => getApiUrl(), /must be a valid HTTPS URL or local HTTP URL/);
    process.env.CODEATLAS_API_URL = "http://localhost.evil.test";
    assert.throws(() => getApiUrl(), /must be a valid HTTPS URL or local HTTP URL/);
    process.env.CODEATLAS_API_URL = "http://192.168.1.1";
    assert.throws(() => getApiUrl(), /must be a valid HTTPS URL or local HTTP URL/);
  });

  it("returns HTTP URLs for loopback hosts", () => {
    process.env.CODEATLAS_API_URL = "http://127.0.0.1:3381";
    assert.strictEqual(getApiUrl(), "http://127.0.0.1:3381");
    process.env.CODEATLAS_API_URL = "http://localhost:3381";
    assert.strictEqual(getApiUrl(), "http://localhost:3381");
    process.env.CODEATLAS_API_URL = "http://[::1]:3381";
    assert.strictEqual(getApiUrl(), "http://[::1]:3381");
  });

  it("returns the configured URL for any domain on HTTPS", () => {
    process.env.CODEATLAS_API_URL = "https://example.com";
    assert.strictEqual(getApiUrl(), "https://example.com");
    process.env.CODEATLAS_API_URL = "https://127.0.0.1:3381";
    assert.strictEqual(getApiUrl(), "https://127.0.0.1:3381");
  });

  it("trims whitespace and strips trailing slashes", () => {
    process.env.CODEATLAS_API_URL = "  http://127.0.0.1:3381///  ";
    assert.strictEqual(getApiUrl(), "http://127.0.0.1:3381");
  });
});
