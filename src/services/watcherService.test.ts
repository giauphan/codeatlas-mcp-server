import { describe, it } from "node:test";
import * as assert from "node:assert";
import { isIndexingEnabledForProject, httpsWrapper } from "./watcherService.js";

describe("WatcherService tests", () => {
  it("should return true if CODEATLAS_API_KEY is not set", async () => {
    const originalKey = process.env.CODEATLAS_API_KEY;
    delete process.env.CODEATLAS_API_KEY;
    try {
      const enabled = await isIndexingEnabledForProject("test-project");
      assert.strictEqual(enabled, true);
    } finally {
      if (originalKey === undefined) {
        delete process.env.CODEATLAS_API_KEY;
      } else {
        process.env.CODEATLAS_API_KEY = originalKey;
      }
    }
  });

  it("should handle HTTPS request correctly and parse response", async () => {
    const originalKey = process.env.CODEATLAS_API_KEY;
    process.env.CODEATLAS_API_KEY = "test-api-key";
    process.env.CODEATLAS_API_URL = "https://test.api/";

    const originalRequest = httpsWrapper.request;
    let requestOptions: any = null;

    httpsWrapper.request = (options: any, callback: any) => {
      requestOptions = options;
      const mockResponse: any = {
        statusCode: 200,
        on: (event: string, handler: any) => {
          if (event === "data") {
            handler(JSON.stringify({ indexingEnabled: false }));
          } else if (event === "end") {
            handler();
          }
        }
      };
      
      const mockRequest: any = {
        on: () => {},
        setTimeout: () => {},
        end: () => {
          callback(mockResponse);
        }
      };
      return mockRequest as any;
    };

    try {
      const enabled = await isIndexingEnabledForProject("my-project");
      assert.strictEqual(enabled, false);
      assert.strictEqual(requestOptions.headers["x-api-key"], "test-api-key");
      assert.ok(requestOptions.path.includes("projectName=my-project"));
    } finally {
      httpsWrapper.request = originalRequest;
      if (originalKey === undefined) {
        delete process.env.CODEATLAS_API_KEY;
      } else {
        process.env.CODEATLAS_API_KEY = originalKey;
      }
    }
  });
});
