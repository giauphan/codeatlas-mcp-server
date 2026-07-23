import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const ADR_DIR = path.join(os.homedir(), ".codeatlas", "adr", "__test__");

describe("ADR Service — CRUD operations", () => {
  before(() => {
    fs.mkdirSync(ADR_DIR, { recursive: true });
  });

  after(() => {
    try { fs.rmSync(ADR_DIR, { recursive: true, force: true }); } catch { /* skip */ }
  });

  it("saveADR — creates a JSON file with correct fields", async () => {
    const { saveADR, getADR } = await import("./adrService.js");
    const adr = saveADR({
      id: "adr-001", title: "Test Decision", status: "proposed",
      context: "Need to test", decision: "Use Jest",
      consequences: "Faster tests", project: "__test__",
      date: "2024-01-01",
    });
    assert.strictEqual(adr.id, "adr-001");
    assert.strictEqual(adr.status, "proposed");

    const filePath = path.join(ADR_DIR, "adr-001.json");
    assert.ok(fs.existsSync(filePath), "File should exist");

    const fromDisk = getADR("adr-001", "__test__");
    assert.ok(fromDisk);
    assert.strictEqual(fromDisk!.title, "Test Decision");
    assert.strictEqual(fromDisk!.decision, "Use Jest");
  });

  it("listADRs — returns all ADRs sorted by date", async () => {
    const { saveADR, listADRs } = await import("./adrService.js");
    saveADR({ id: "adr-002", title: "Older", status: "accepted" as const, context: "", decision: "A", consequences: "", project: "__test__", date: "2023-01-01" });
    saveADR({ id: "adr-003", title: "Newer", status: "accepted" as const, context: "", decision: "B", consequences: "", project: "__test__", date: "2024-06-01" });

    const all = listADRs("__test__");
    assert.ok(all.length >= 3);
    // Newest first
    assert.strictEqual(all[0].date, "2024-06-01");
  });

  it("getADR — returns null for missing ADR", async () => {
    const { getADR } = await import("./adrService.js");
    const result = getADR("adr-nonexistent", "__test__");
    assert.strictEqual(result, null);
  });

  it("deleteADR — removes file", async () => {
    const { saveADR, getADR, deleteADR } = await import("./adrService.js");
    saveADR({ id: "adr-delete-me", title: "Delete", status: "proposed", context: "", decision: "X", consequences: "", project: "__test__", date: "2024-01-01" });
    assert.ok(getADR("adr-delete-me", "__test__") !== null);
    const deleted = deleteADR("adr-delete-me", "__test__");
    assert.strictEqual(deleted, true);
    assert.strictEqual(getADR("adr-delete-me", "__test__"), null);
  });

  it("deleteADR — returns false for missing", async () => {
    const { deleteADR } = await import("./adrService.js");
    const result = deleteADR("adr-ghost", "__test__");
    assert.strictEqual(result, false);
  });

  it("saveADR — auto-assigns date if omitted", async () => {
    const { saveADR } = await import("./adrService.js");
    const adr = saveADR({ id: "adr-nodate", title: "No Date", status: "accepted" as const, context: "", decision: "Y", consequences: "", project: "__test__" });
    assert.ok(adr.date, "Date should be auto-assigned");
    assert.match(adr.date, /^\d{4}-\d{2}-\d{2}$/);
  });
});
