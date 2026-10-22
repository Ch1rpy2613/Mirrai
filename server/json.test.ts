import { describe, expect, it } from "vitest";
import { extractJsonArray, extractJsonObject } from "./_core/json";

describe("extractJsonObject", () => {
  it("parses a bare JSON object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses an object wrapped in a markdown fence", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("parses an object surrounded by prose", () => {
    const text = '好的，结果如下：\n{"personality":"温柔"}\n希望有帮助。';
    expect(extractJsonObject(text)).toEqual({ personality: "温柔" });
  });

  it("handles nested objects", () => {
    const text = '{"outer":{"inner":{"deep":1}}}';
    expect(extractJsonObject(text)).toEqual({ outer: { inner: { deep: 1 } } });
  });

  it("does not break on braces inside strings", () => {
    const text = '{"note":"他说：{这样}"}';
    expect(extractJsonObject(text)).toEqual({ note: "他说：{这样}" });
  });

  it("handles escaped quotes inside strings", () => {
    const text = '{"quote":"she said \\"hi\\""}';
    expect(extractJsonObject(text)).toEqual({ quote: 'she said "hi"' });
  });

  it("returns null for non-object output", () => {
    expect(extractJsonObject("just some text")).toBeNull();
    expect(extractJsonObject("[1,2,3]")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(extractJsonObject("")).toBeNull();
    expect(extractJsonObject(null)).toBeNull();
    expect(extractJsonObject(undefined)).toBeNull();
  });

  it("returns null when the object is truncated", () => {
    expect(extractJsonObject('{"a":1')).toBeNull();
  });
});

describe("extractJsonArray", () => {
  it("parses a bare JSON array", () => {
    expect(extractJsonArray("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("parses an array wrapped in prose", () => {
    const text = '提取结果：\n[{"title":"记忆"}]\n完毕。';
    expect(extractJsonArray(text)).toEqual([{ title: "记忆" }]);
  });

  it("handles nested arrays", () => {
    expect(extractJsonArray("[[1,2],[3]]")).toEqual([[1, 2], [3]]);
  });

  it("returns null for non-array output", () => {
    expect(extractJsonArray('{"a":1}')).toBeNull();
    expect(extractJsonArray("")).toBeNull();
  });
});
