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

  it("throws when CODEATLAS_API_URL is empty", () => {
    process.env.CODEATLAS_API_URL = "";
    assert.throws(() => getApiUrl(), /CODEATLAS_API_URL environment variable is not set/);
  });

  it("returns the configured URL", () => {
    process.env.CODEATLAS_API_URL = "http://127.0.0.1:3381";
    assert.strictEqual(getApiUrl(), "http://127.0.0.1:3381");
  });

  it("strips trailing slashes", () => {
    process.env.CODEATLAS_API_URL = "http://127.0.0.1:3381///";
    assert.strictEqual(getApiUrl(), "http://127.0.0.1:3381");
  });
});
