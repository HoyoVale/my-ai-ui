import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  FinalResponseStream
} from "../../electron/agent/finalization/FinalResponseStream.js";

describe("FinalResponseStream", () => {
  it("publishes final chunks incrementally", () => {
    const appended = [];
    const replaced = [];
    const states = [];
    const stream = new FinalResponseStream({
      onAppend: (chunk) => appended.push(chunk),
      onReplace: (text) => replaced.push(text),
      onText: (text) => states.push(text)
    });

    stream.reset();
    stream.append("第一段");
    stream.append("第二段");

    assert.equal(stream.snapshot(), "第一段第二段");
    assert.deepEqual(appended, ["第一段", "第二段"]);
    assert.deepEqual(replaced, [""]);
    assert.deepEqual(states, ["", "第一段", "第一段第二段"]);
  });

  it("does not replace an unchanged reconciled answer", () => {
    const replaced = [];
    const stream = new FinalResponseStream({
      onReplace: (text) => replaced.push(text)
    });

    stream.reset();
    stream.append("已验证结果");
    const result = stream.commit("已验证结果");

    assert.deepEqual(result, {
      changed: false,
      operation: "none",
      text: "已验证结果"
    });
    assert.deepEqual(replaced, [""]);
  });

  it("atomically replaces text changed by evidence reconciliation", () => {
    const replaced = [];
    const states = [];
    const stream = new FinalResponseStream({
      onReplace: (text) => replaced.push(text),
      onText: (text) => states.push(text)
    });

    stream.reset();
    stream.append("构建已经成功。");
    const result = stream.commit("构建未执行，无法确认成功。");

    assert.equal(result.operation, "replace");
    assert.equal(result.changed, true);
    assert.equal(stream.snapshot(), "构建未执行，无法确认成功。");
    assert.deepEqual(replaced, ["", "构建未执行，无法确认成功。"]);
    assert.equal(states.at(-1), "构建未执行，无法确认成功。");
  });

  it("suppresses output after the run is no longer active", () => {
    let active = true;
    const appended = [];
    const stream = new FinalResponseStream({
      isActive: () => active,
      onAppend: (chunk) => appended.push(chunk)
    });

    stream.reset();
    stream.append("保留");
    active = false;
    stream.append("丢弃");
    const result = stream.commit("不会发布");

    assert.deepEqual(appended, ["保留"]);
    assert.equal(result.operation, "inactive");
  });
});
