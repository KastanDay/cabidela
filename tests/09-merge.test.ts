import { expect, describe, test } from "vitest";
import { Cabidela } from "../src";
import { FakeCabidela } from "./lib/fake-cabidela";

describe("$merge", () => {
  test.skipIf(process.env.AJV)("two objects", () => {
    let schema = {
      $merge: {
        source: {
          type: "object",
          properties: { p: { type: "string" } },
          additionalProperties: false,
        },
        with: {
          properties: { q: { type: "number" } },
        },
      },
    };
    const cabidela = new FakeCabidela(schema, { useMerge: true });
    schema = cabidela.getSchema();
    expect(schema).toStrictEqual({
      type: "object",
      properties: { p: { type: "string" }, q: { type: "number" } },
      additionalProperties: false,
    });
  });

  test.skipIf(process.env.AJV)("two objects, with arrays", () => {
    let schema = {
      $merge: {
        source: {
          type: "object",
          properties: { p: [1, 2] },
        },
        with: {
          properties: { p: [3, 4] },
        },
      },
    };
    const cabidela = new FakeCabidela(schema, { useMerge: true });
    schema = cabidela.getSchema();
    expect(schema).toStrictEqual({
      type: "object",
      properties: { p: [1, 2, 3, 4] },
    });
  });

  test.skipIf(process.env.AJV)("two objects, with $defs and $ref", () => {
    let schema = {
      $merge: {
        source: {
          type: "object",
          properties: { p: { type: "string" } },
          additionalProperties: false,
        },
        with: {
          properties: {
            q: {
              type: "string",
              maxLength: { $ref: "$defs#/max_tokens" },
            },
          },
        },
      },
      $defs: {
        max_tokens: 250,
      },
    };
    const cabidela = new FakeCabidela(schema, { useMerge: true });
    schema = cabidela.getSchema();
    expect(schema).toStrictEqual({
      type: "object",
      properties: { p: { type: "string" }, q: { type: "string", maxLength: 250 } },
      additionalProperties: false,
    });
  });
});

describe("$patch", () => {
  test.skipIf(process.env.AJV)("applies JSON Patch operations", () => {
    let schema = {
      $patch: {
        source: {
          type: "object",
          properties: {
            effort: { type: "string", enum: ["low", "medium", "high"] },
            obsolete: { type: "boolean" },
          },
          required: ["effort"],
        },
        with: [
          { op: "replace", path: "/properties/effort/enum", value: ["low", "medium", "high", "max", null] },
          { op: "add", path: "/properties/effort/default", value: "max" },
          { op: "remove", path: "/properties/obsolete" },
          { op: "copy", from: "/properties/effort", path: "/properties/copied_effort" },
          { op: "move", from: "/required/0", path: "/required/0" },
          { op: "test", path: "/properties/effort/default", value: "max" },
        ],
      },
    };
    const cabidela = new FakeCabidela(schema, { usePatch: true });
    schema = cabidela.getSchema();
    expect(schema).toStrictEqual({
      type: "object",
      properties: {
        effort: { type: "string", enum: ["low", "medium", "high", "max", null], default: "max" },
        copied_effort: { type: "string", enum: ["low", "medium", "high", "max", null], default: "max" },
      },
      required: ["effort"],
    });
  });

  test.skipIf(process.env.AJV)("resolves references before applying a patch", () => {
    let schema = {
      $patch: {
        source: { $ref: "$defs#/input" },
        with: [{ op: "replace", path: "/properties/effort/enum", value: ["low", "high"] }],
      },
      $defs: {
        input: {
          type: "object",
          properties: { effort: { type: "string", enum: ["low", "medium", "high"] } },
        },
      },
    };
    const cabidela = new FakeCabidela(schema, { usePatch: true });
    schema = cabidela.getSchema();
    expect(schema).toStrictEqual({
      type: "object",
      properties: { effort: { type: "string", enum: ["low", "high"] } },
    });
  });

  test.skipIf(process.env.AJV)("rejects a failed test operation", () => {
    const schema = {
      $patch: {
        source: { type: "string" },
        with: [{ op: "test", path: "/type", value: "number" }],
      },
    };
    expect(() => new FakeCabidela(schema, { usePatch: true })).toThrowError("JSON patch test failed at '/type'");
  });

  test.skipIf(process.env.AJV).each([
    { $patch: { with: [] } },
    { $patch: { source: { type: "string" }, with: [{ op: "remove", path: "" }] } },
    { $patch: { source: { type: "string" }, with: [{ op: "replace", path: "", value: false }] } },
  ])("rejects a patch that does not produce an object schema", (schema) => {
    expect(() => new FakeCabidela(schema, { usePatch: true })).toThrowError(
      "$patch result must be an object schema",
    );
  });

  test("resolves patches installed through setSchema", () => {
    const cabidela = new Cabidela({ type: "string" }, { usePatch: true });

    cabidela.setSchema({
      $patch: {
        source: { type: "string", enum: ["low", "high"] },
        with: [{ op: "add", path: "/enum/-", value: "max" }],
      },
    });

    expect(cabidela.getSchema()).toStrictEqual({ type: "string", enum: ["low", "high", "max"] });
    expect(() => cabidela.validate("max")).not.toThrow();
  });

  test("resolves existing patches when setOptions enables them", () => {
    const cabidela = new Cabidela({
      $patch: {
        source: { type: "string", enum: ["low", "high"] },
        with: [{ op: "add", path: "/enum/-", value: "max" }],
      },
    });

    cabidela.setOptions({ usePatch: true });

    expect(cabidela.getSchema()).toStrictEqual({ type: "string", enum: ["low", "high", "max"] });
    expect(() => cabidela.validate("max")).not.toThrow();
  });

  test("retains the active schema when setSchema preparation fails", () => {
    const cabidela = new Cabidela({ type: "string" }, { usePatch: true });

    expect(() =>
      cabidela.setSchema({
        $patch: {
          source: { type: "object" },
          with: [{ op: "remove", path: "/missing" }],
        },
      }),
    ).toThrowError("JSON Pointer '/missing' does not exist");

    expect(cabidela.getSchema()).toStrictEqual({ type: "string" });
    expect(() => cabidela.validate(42)).toThrow();
  });

  test("does not retain an invalid added schema", () => {
    const cabidela = new Cabidela({ type: "string" });

    expect(() => cabidela.addSchema({ type: "object" })).toThrowError("subSchemas need $id");
    expect(() => cabidela.setSchema({ type: "number" })).not.toThrow();
    expect(() => cabidela.validate(42)).not.toThrow();
  });

  test("does not retain invalid options", () => {
    const cabidela = new Cabidela({ type: "string" });

    expect(() => cabidela.setOptions({ subSchemas: [{ type: "object" }] })).toThrowError(
      "subSchemas need $id",
    );
    expect(() => cabidela.setSchema({ type: "number" })).not.toThrow();
    expect(() => cabidela.validate(42)).not.toThrow();
  });

  test.each(["__proto__", "constructor", "prototype"])(
    "adds %s as an own JSON Pointer member",
    (property) => {
      const cabidela = new Cabidela(
        {
          $patch: {
            source: { type: "object", properties: {} },
            with: [{ op: "add", path: `/properties/${property}`, value: { type: "string" } }],
          },
        },
        { usePatch: true },
      );
      const properties = cabidela.getSchema().properties;

      expect(Object.hasOwn(properties, property)).toBe(true);
      expect(properties[property]).toStrictEqual({ type: "string" });
      expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
    },
  );
});
