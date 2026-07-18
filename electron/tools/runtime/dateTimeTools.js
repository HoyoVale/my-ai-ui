import {
  z
} from "zod";

import {
  evaluateExpression
} from "./calculator.js";

import {
  createRuntimeSnapshot,
  getLocalTimezone,
  getRuntimeLocale
} from "../../runtime/runtimeContextProvider.js";

function validateTimeZone(
  timeZone
) {
  const value =
    String(timeZone ?? "")
      .trim();

  try {
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: value
      }
    );

    return value;
  } catch {
    const error = new Error(
      `无效的 IANA 时区：${value}`
    );
    error.code =
      "INVALID_TIMEZONE";
    throw error;
  }
}

function formatDate(
  date,
  timeZone,
  locale
) {
  return new Intl.DateTimeFormat(
    locale,
    {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset"
    }
  ).format(date);
}

function timezoneOffsetMs(
  date,
  timeZone
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }
    ).formatToParts(date);

  const values =
    Object.fromEntries(
      parts.map(
        (part) => [
          part.type,
          part.value
        ]
      )
    );

  const representedUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return representedUtc -
    date.getTime();
}

function parseLocalDateTime(
  value,
  timeZone
) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/u
      .exec(value);

  if (!match) {
    throw new Error(
      "日期时间应为 ISO 格式，例如 2026-07-18T11:30:00。"
    );
  }

  const milliseconds =
    Number(
      String(match[7] ?? "0")
        .padEnd(3, "0")
    );

  const guess = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0),
    milliseconds
  );

  let instant = guess;

  for (
    let attempt = 0;
    attempt < 3;
    attempt += 1
  ) {
    const offset =
      timezoneOffsetMs(
        new Date(instant),
        timeZone
      );

    instant = guess - offset;
  }

  return new Date(instant);
}

function parseDateTime(
  value,
  fromTimeZone
) {
  const source =
    String(value ?? "")
      .trim();

  if (!source) {
    return new Date();
  }

  if (
    /(?:Z|[+-]\d{2}:?\d{2})$/iu
      .test(source)
  ) {
    const date = new Date(source);

    if (Number.isNaN(date.getTime())) {
      throw new Error(
        "无法解析日期时间。"
      );
    }

    return date;
  }

  return parseLocalDateTime(
    source,
    validateTimeZone(
      fromTimeZone
    )
  );
}

function addDate(
  date,
  amount,
  unit
) {
  const next =
    new Date(date.getTime());

  const units = {
    milliseconds: 1,
    seconds: 1000,
    minutes: 60_000,
    hours: 3_600_000,
    days: 86_400_000,
    weeks: 604_800_000
  };

  if (unit in units) {
    return new Date(
      next.getTime() +
      amount * units[unit]
    );
  }

  if (unit === "months") {
    next.setUTCMonth(
      next.getUTCMonth() +
      amount
    );
    return next;
  }

  if (unit === "years") {
    next.setUTCFullYear(
      next.getUTCFullYear() +
      amount
    );
    return next;
  }

  throw new Error(
    `不支持的日期单位：${unit}`
  );
}

export function createDateTimeToolDefinitions() {
  return [
    {
      name: "get_current_time",
      title: "Get current time",
      description:
        "Get the exact current local and UTC date/time. Use this instead of guessing the current date or time.",
      inputSchema: z.object({
        timeZone: z.string()
          .max(100)
          .optional()
          .describe(
            "Optional IANA time zone such as Asia/Shanghai. Defaults to the user's local time zone."
          ),
        locale: z.string()
          .max(50)
          .optional()
      }),
      async execute({
        timeZone,
        locale
      }) {
        const now = new Date();
        const zone =
          validateTimeZone(
            timeZone ||
            getLocalTimezone()
          );
        const resolvedLocale =
          locale ||
          getRuntimeLocale();

        return {
          localDateTime:
            formatDate(
              now,
              zone,
              resolvedLocale
            ),
          utcDateTime:
            now.toISOString(),
          timeZone: zone,
          locale:
            resolvedLocale,
          unixMilliseconds:
            now.getTime()
        };
      }
    },
    {
      name: "convert_time_zone",
      title: "Convert time zone",
      description:
        "Convert an ISO date/time from one IANA time zone to another. Use an explicit source time zone when the input has no UTC offset.",
      inputSchema: z.object({
        dateTime: z.string()
          .min(1)
          .max(100),
        fromTimeZone: z.string()
          .max(100)
          .optional(),
        toTimeZone: z.string()
          .min(1)
          .max(100),
        locale: z.string()
          .max(50)
          .optional()
      }),
      async execute(input) {
        const fromZone =
          validateTimeZone(
            input.fromTimeZone ||
            getLocalTimezone()
          );
        const toZone =
          validateTimeZone(
            input.toTimeZone
          );
        const date =
          parseDateTime(
            input.dateTime,
            fromZone
          );
        const locale =
          input.locale ||
          getRuntimeLocale();

        return {
          source:
            formatDate(
              date,
              fromZone,
              locale
            ),
          converted:
            formatDate(
              date,
              toZone,
              locale
            ),
          instant:
            date.toISOString(),
          fromTimeZone:
            fromZone,
          toTimeZone:
            toZone
        };
      }
    },
    {
      name: "calculate_date",
      title: "Calculate date",
      description:
        "Add or subtract time, calculate the difference between two dates, or determine a weekday.",
      inputSchema: z.object({
        operation: z.enum([
          "add",
          "subtract",
          "difference",
          "day_of_week"
        ]),
        dateTime: z.string()
          .max(100)
          .optional(),
        otherDateTime: z.string()
          .max(100)
          .optional(),
        amount: z.number()
          .finite()
          .optional(),
        unit: z.enum([
          "milliseconds",
          "seconds",
          "minutes",
          "hours",
          "days",
          "weeks",
          "months",
          "years"
        ]).optional(),
        timeZone: z.string()
          .max(100)
          .optional(),
        locale: z.string()
          .max(50)
          .optional()
      }),
      async execute(input) {
        const zone =
          validateTimeZone(
            input.timeZone ||
            getLocalTimezone()
          );
        const locale =
          input.locale ||
          getRuntimeLocale();
        const base =
          parseDateTime(
            input.dateTime,
            zone
          );

        if (
          input.operation ===
          "difference"
        ) {
          if (!input.otherDateTime) {
            throw new Error(
              "difference 操作需要 otherDateTime。"
            );
          }

          const other =
            parseDateTime(
              input.otherDateTime,
              zone
            );
          const milliseconds =
            other.getTime() -
            base.getTime();

          return {
            from:
              base.toISOString(),
            to:
              other.toISOString(),
            milliseconds,
            seconds:
              milliseconds / 1000,
            hours:
              milliseconds /
              3_600_000,
            days:
              milliseconds /
              86_400_000
          };
        }

        if (
          input.operation ===
          "day_of_week"
        ) {
          return {
            instant:
              base.toISOString(),
            formatted:
              formatDate(
                base,
                zone,
                locale
              ),
            weekday:
              new Intl.DateTimeFormat(
                locale,
                {
                  timeZone: zone,
                  weekday: "long"
                }
              ).format(base)
          };
        }

        if (
          !Number.isFinite(
            input.amount
          ) ||
          !input.unit
        ) {
          throw new Error(
            "add/subtract 操作需要 amount 和 unit。"
          );
        }

        const signedAmount =
          input.operation ===
          "subtract"
            ? -input.amount
            : input.amount;
        const result =
          addDate(
            base,
            signedAmount,
            input.unit
          );

        return {
          source:
            base.toISOString(),
          result:
            result.toISOString(),
          formatted:
            formatDate(
              result,
              zone,
              locale
            ),
          timeZone: zone
        };
      }
    },
    {
      name: "calculator",
      title: "Calculator",
      description:
        "Evaluate a deterministic arithmetic expression. Supports +, -, *, /, %, ^, parentheses, pi, e, and common math functions.",
      inputSchema: z.object({
        expression: z.string()
          .min(1)
          .max(500)
      }),
      async execute({
        expression
      }) {
        return {
          expression,
          result:
            evaluateExpression(
              expression
            )
        };
      }
    }
  ];
}

export function getRuntimeSnapshotForTool(
  options = {}
) {
  return createRuntimeSnapshot(
    options
  );
}
