import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  createDateTimeToolDefinitions
} from "../../electron/tools/runtime/dateTimeTools.js";

function getTool(name) {
  return createDateTimeToolDefinitions()
    .find(
      (tool) =>
        tool.name === name
    );
}

describe(
  "date and time tools",
  () => {
    it(
      "converts an instant between IANA time zones",
      async () => {
        const result =
          await getTool(
            "convert_time_zone"
          ).execute({
            dateTime:
              "2026-07-18T03:30:00Z",
            toTimeZone:
              "Asia/Shanghai",
            locale: "zh-CN"
          });

        assert.equal(
          result.instant,
          "2026-07-18T03:30:00.000Z"
        );
        assert.match(
          result.converted,
          /11:30/u
        );
      }
    );

    it(
      "rejects impossible and nonexistent local times",
      async () => {
        await assert.rejects(
          getTool("convert_time_zone").execute({
            dateTime: "2026-02-30T12:00:00",
            fromTimeZone: "Asia/Shanghai",
            toTimeZone: "UTC",
            locale: "zh-CN"
          }),
          (error) => error?.code === "INVALID_DATE_TIME"
        );
        await assert.rejects(
          getTool("convert_time_zone").execute({
            dateTime: "2026-03-08T02:30:00",
            fromTimeZone: "America/New_York",
            toTimeZone: "UTC",
            locale: "en-US"
          }),
          (error) => error?.code === "NONEXISTENT_LOCAL_TIME"
        );
      }
    );

    it(
      "preserves local wall time for calendar-day arithmetic across DST",
      async () => {
        const result = await getTool("calculate_date").execute({
          operation: "add",
          dateTime: "2026-03-07T12:00:00",
          amount: 1,
          unit: "days",
          timeZone: "America/New_York",
          locale: "en-US"
        });
        assert.equal(result.arithmetic, "calendar");
        assert.match(result.formatted, /03\/08\/2026, 12:00/u);
      }
    );

    it(
      "calculates deterministic date differences",
      async () => {
        const result =
          await getTool(
            "calculate_date"
          ).execute({
            operation:
              "difference",
            dateTime:
              "2026-07-18T00:00:00Z",
            otherDateTime:
              "2026-07-20T12:00:00Z",
            timeZone: "UTC"
          });

        assert.equal(
          result.hours,
          60
        );
        assert.equal(
          result.days,
          2.5
        );
      }
    );
  }
);
