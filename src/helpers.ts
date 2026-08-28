import type { CabidelaOptions } from ".";

export type metaData = {
  types: Set<string>;
  size: number;
  properties: Array<string>;
};

export type resolvedResponse = {
  metadata: metaData;
  resolvedObject: any;
};

export const includesAll = (arr: Array<any>, values: Array<any>) => {
  return values.every((v) => arr.includes(v));
};

// https://json-schema.org/understanding-json-schema/structuring#dollarref
export const parse$ref = (ref: string) => {
  const parts = ref.split("#");
  return {
    $id: parts[0],
    $path: parts[1].split("/").filter((part: string) => part != ""),
  };
};

function deepMerge(target: any, source: any) {
  const result = Array(target) && Array.isArray(source) ? target.concat(source) : { ...target, ...source };
  for (const key of Object.keys(result)) {
    result[key] =
      typeof target[key] == "object" && typeof source[key] == "object"
        ? deepMerge(target[key], source[key])
        : structuredClone(result[key]);
  }
  return result;
}

type JsonPatchOperation = {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  from?: string;
  value?: any;
};

const parseJsonPointer = (pointer: string): string[] => {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`Invalid JSON Pointer '${pointer}'`);
  if (/~(?:[^01]|$)/.test(pointer)) throw new Error(`Invalid JSON Pointer '${pointer}'`);
  return pointer
    .slice(1)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
};

const arrayIndex = (token: string, length: number, allowEnd: boolean): number => {
  if (!/^(0|[1-9][0-9]*)$/.test(token)) throw new Error(`Invalid array index '${token}'`);
  const index = Number(token);
  if (index > length || (!allowEnd && index === length)) throw new Error(`Array index '${token}' is out of bounds`);
  return index;
};

const getJsonPointer = (document: any, pointer: string): any => {
  let value = document;
  for (const token of parseJsonPointer(pointer)) {
    if (Array.isArray(value)) {
      value = value[arrayIndex(token, value.length, false)];
    } else if (value !== null && typeof value === "object" && Object.hasOwn(value, token)) {
      value = value[token];
    } else {
      throw new Error(`JSON Pointer '${pointer}' does not exist`);
    }
  }
  return value;
};

const getJsonPointerParent = (document: any, pointer: string) => {
  const path = parseJsonPointer(pointer);
  if (path.length === 0) return { parent: undefined, token: undefined };
  const token = path.pop() as string;
  const parentPointer =
    path.length === 0 ? "" : `/${path.map((part) => part.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
  return { parent: getJsonPointer(document, parentPointer), token };
};

const addJsonPointer = (document: any, pointer: string, value: any): any => {
  const { parent, token } = getJsonPointerParent(document, pointer);
  if (token === undefined) return value;
  if (Array.isArray(parent)) {
    if (token === "-") {
      parent.push(value);
    } else {
      parent.splice(arrayIndex(token, parent.length, true), 0, value);
    }
  } else if (parent !== null && typeof parent === "object") {
    Object.defineProperty(parent, token, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    throw new Error(`JSON Pointer '${pointer}' parent is not a container`);
  }
  return document;
};

const removeJsonPointer = (document: any, pointer: string): any => {
  const { parent, token } = getJsonPointerParent(document, pointer);
  if (token === undefined) return undefined;
  if (Array.isArray(parent)) {
    parent.splice(arrayIndex(token, parent.length, false), 1);
  } else if (parent !== null && typeof parent === "object" && Object.hasOwn(parent, token)) {
    delete parent[token];
  } else {
    throw new Error(`JSON Pointer '${pointer}' does not exist`);
  }
  return document;
};

const replaceJsonPointer = (document: any, pointer: string, value: any): any => {
  const { parent, token } = getJsonPointerParent(document, pointer);
  if (token === undefined) return value;
  if (Array.isArray(parent)) {
    parent[arrayIndex(token, parent.length, false)] = value;
  } else if (parent !== null && typeof parent === "object" && Object.hasOwn(parent, token)) {
    Object.defineProperty(parent, token, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    throw new Error(`JSON Pointer '${pointer}' does not exist`);
  }
  return document;
};

const jsonEquals = (left: any, right: any): boolean => {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && jsonEquals(left[key], right[key]))
  );
};

const applyJsonPatch = (source: any, operations: JsonPatchOperation[]): any => {
  if (!Array.isArray(operations)) throw new Error("$patch 'with' must be an array");
  let document = structuredClone(source);
  for (const operation of operations) {
    if (!operation || typeof operation.path !== "string") throw new Error("Invalid JSON patch operation");
    switch (operation.op) {
      case "add":
        if (!Object.hasOwn(operation, "value")) throw new Error("JSON patch add operation requires 'value'");
        document = addJsonPointer(document, operation.path, structuredClone(operation.value));
        break;
      case "remove":
        document = removeJsonPointer(document, operation.path);
        break;
      case "replace":
        if (!Object.hasOwn(operation, "value")) throw new Error("JSON patch replace operation requires 'value'");
        document = replaceJsonPointer(document, operation.path, structuredClone(operation.value));
        break;
      case "move": {
        if (typeof operation.from !== "string") throw new Error("JSON patch move operation requires 'from'");
        const value = getJsonPointer(document, operation.from);
        document = removeJsonPointer(document, operation.from);
        document = addJsonPointer(document, operation.path, value);
        break;
      }
      case "copy":
        if (typeof operation.from !== "string") throw new Error("JSON patch copy operation requires 'from'");
        document = addJsonPointer(document, operation.path, structuredClone(getJsonPointer(document, operation.from)));
        break;
      case "test":
        if (!Object.hasOwn(operation, "value")) throw new Error("JSON patch test operation requires 'value'");
        if (!jsonEquals(getJsonPointer(document, operation.path), operation.value)) {
          throw new Error(`JSON patch test failed at '${operation.path}'`);
        }
        break;
      default:
        throw new Error(`Unsupported JSON patch operation '${operation.op}'`);
    }
  }
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("$patch result must be an object schema");
  }
  return document;
};

export const traverseSchema = (options: CabidelaOptions, definitions: any, obj: any) => {
  const ts = (obj: any, cb?: any) => {
    if (obj === null || typeof obj !== "object") return;
    let hits: number;
    do {
      hits = 0;
      for (const key of Object.keys(obj)) {
        if (obj[key] !== null && typeof obj[key] == "object") {
          ts(obj[key], (value: any) => {
            obj[key] = value;
            hits++;
          });
          if (options.useMerge && key == "$merge") {
            const merge = deepMerge(obj[key].source, obj[key].with);
            if (cb) {
              cb(merge);
            } else {
              // root level
              hits++;
              Object.assign(obj, merge);
              delete obj[key];
            }
          }
          if (options.usePatch && key == "$patch") {
            const patch = applyJsonPatch(obj[key].source, obj[key].with);
            if (cb) {
              cb(patch);
            } else {
              hits++;
              Object.assign(obj, patch);
              delete obj[key];
            }
          }
        } else {
          if (key == "$ref") {
            const { $id, $path } = parse$ref(obj[key]);
            const { resolvedObject } = resolvePayload($path, definitions[$id]);
            if (resolvedObject) {
              if (cb) {
                cb(resolvedObject);
              } else {
                // root level
                hits++;
                Object.assign(obj, resolvedObject);
                delete obj[key];
              }
            } else {
              throw new Error(`Could not resolve '${obj[key]}' $ref`);
            }
          }
        }
      }
    } while (hits > 0);
  };
  ts(obj);
};

/* Resolves a path in an object

     obj = {
       prompt: "hello",
       messages: [
         { role: "system", content: "you are a helpful assistant" },
         { role: "user", content: "tell me a joke" },
       ]
     }

     path = ["messages"]
     returns [
       { role: "system", content: "you are a helpful assistant" },
       { role: "user", content: "tell me a joke" },
     ]

     path = ["messages", 1, "role"]
     returns "system"

     path = ["prompt"]
     returns "hello"

     path = ["invalid", "path"]
     returns undefined

  */

export const resolvePayload = (path: Array<string | number>, obj: any): resolvedResponse => {
  let resolvedObject = path.reduce(function (prev, curr) {
    return prev ? prev[curr] : undefined;
  }, obj);

  return { metadata: getMetaData(resolvedObject), resolvedObject };
};

// JSON Pointer notation https://datatracker.ietf.org/doc/html/rfc6901
export const pathToString = (path: Array<string | number>) => {
  return path.length == 0 ? `/` : path.map((item) => `/${item}`).join("");
};

// https://json-schema.org/understanding-json-schema/reference/type
export const getMetaData = (value: any): metaData => {
  let size = 0;
  let types: any = new Set([]);
  let properties: any = [];
  if (value === null) {
    types.add("null");
  } else if (typeof value == "string") {
    types.add("string");
    size = value.length;
  } else if (typeof value == "number") {
    size = 1;
    types.add("number");
    if (Number.isInteger(value)) {
      types.add("integer");
    }
  } else if (typeof value == "boolean") {
    types.add("boolean");
    size = 1;
  } else if (Array.isArray(value)) {
    size = value.length;
    types.add("array");
    if (value.find((item) => typeof item !== "number" && typeof item !== "string") == undefined) {
      types.add("binary");
    }
  } else if (typeof value == "object") {
    types.add("object");
    size = Object.keys(value).length;
    properties = Object.keys(value);
  }
  return { types, size, properties };
};
