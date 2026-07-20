import { z } from "zod";

import { evaluateExpression } from "./calculator.js";

import {
  createRuntimeSnapshot,
  getLocalTimezone,
  getRuntimeLocale
} from "../../runtime/runtimeContextProvider.js";

function dateToolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateTimeZone(timeZone) {
  const value = String(timeZone ?? "").trim();
  if (!value) {
    throw dateToolError("INVALID_TIMEZONE", "时区不能为空。");
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    throw dateToolError("INVALID_TIMEZONE", `无效的 IANA 时区：${value}`);
  }
}

function validateLocale(locale) {
  const value = String(locale ?? "").trim();
  if (!value) {
    return getRuntimeLocale();
  }

  try {
    const [canonical] = Intl.getCanonicalLocales(value);
    new Intl.DateTimeFormat(canonical).format(new Date(0));
    return canonical;
  } catch {
    throw dateToolError("INVALID_LOCALE", `无效的 Locale：${value}`);
  }
}

function formatDate(date, timeZone, locale) {
  return new Intl.DateTimeFormat(locale, {
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
  }).format(date);
}

function formatOffset(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset"
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")
    ?.value ?? "GMT";
}

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    millisecond: date.getUTCMilliseconds()
  };
}

function createUtcDate(parts) {
  const date = new Date(0);
  date.setUTCFullYear(
    parts.year,
    parts.month - 1,
    parts.day
  );
  date.setUTCHours(
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
    parts.millisecond ?? 0
  );
  return date;
}

function timezoneOffsetMs(date, timeZone) {
  const parts = localParts(date, timeZone);
  return createUtcDate(parts).getTime() - date.getTime();
}

function daysInMonth(year, month) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCDate();
}

function assertValidCalendarParts(parts) {
  const { year, month, day, hour, minute, second, millisecond } = parts;
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw dateToolError("INVALID_DATE_TIME", "年份必须在 0001 到 9999 之间。");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw dateToolError("INVALID_DATE_TIME", "月份必须在 1 到 12 之间。");
  }
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw dateToolError("INVALID_DATE_TIME", "日期中的日数无效。");
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw dateToolError("INVALID_DATE_TIME", "小时必须在 0 到 23 之间。");
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw dateToolError("INVALID_DATE_TIME", "分钟必须在 0 到 59 之间。");
  }
  if (!Number.isInteger(second) || second < 0 || second > 59) {
    throw dateToolError("INVALID_DATE_TIME", "秒必须在 0 到 59 之间。");
  }
  if (!Number.isInteger(millisecond) || millisecond < 0 || millisecond > 999) {
    throw dateToolError("INVALID_DATE_TIME", "毫秒必须在 0 到 999 之间。");
  }
}

function sameLocalParts(left, right) {
  return [
    "year",
    "month",
    "day",
    "hour",
    "minute",
    "second"
  ].every((key) => left[key] === right[key]);
}

function parseLocalDateTime(value, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/u.exec(
    value
  );

  if (!match) {
    throw dateToolError(
      "INVALID_DATE_TIME",
      "日期时间应为 ISO 本地格式，例如 2026-07-18T11:30:00。"
    );
  }

  const requested = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
    millisecond: Number(String(match[7] ?? "0").padEnd(3, "0"))
  };
  assertValidCalendarParts(requested);

  const guess = createUtcDate(requested).getTime();
  let instant = guess;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    instant = guess - timezoneOffsetMs(new Date(instant), timeZone);
  }

  const date = new Date(instant);
  const represented = localParts(date, timeZone);
  if (!sameLocalParts(requested, represented)) {
    throw dateToolError(
      "NONEXISTENT_LOCAL_TIME",
      `本地时间 ${value} 在时区 ${timeZone} 中不存在，可能处于夏令时跳变区间。`
    );
  }

  return date;
}

function parseDateTime(value, fromTimeZone, { defaultToNow = true } = {}) {
  const source = String(value ?? "").trim();

  if (!source) {
    if (defaultToNow) {
      return new Date();
    }
    throw dateToolError("DATE_TIME_REQUIRED", "日期时间不能为空。");
  }

  if (/(?:Z|[+-]\d{2}:?\d{2})$/iu.test(source)) {
    const date = new Date(source);
    if (Number.isNaN(date.getTime())) {
      throw dateToolError("INVALID_DATE_TIME", "无法解析日期时间。");
    }
    return date;
  }

  return parseLocalDateTime(source, validateTimeZone(fromTimeZone));
}

function addElapsedTime(date, amount, unit) {
  const units = {
    milliseconds: 1,
    seconds: 1000,
    minutes: 60_000,
    hours: 3_600_000
  };
  return new Date(date.getTime() + amount * units[unit]);
}

function addCalendarTime(date, amount, unit, timeZone) {
  if (!Number.isInteger(amount)) {
    throw dateToolError(
      "CALENDAR_AMOUNT_MUST_BE_INTEGER",
      `${unit} 的日期加减需要整数 amount。`
    );
  }

  const source = localParts(date, timeZone);
  const next = { ...source };

  if (unit === "days" || unit === "weeks") {
    const wallClock = createUtcDate(source);
    wallClock.setUTCDate(
      wallClock.getUTCDate() + amount * (unit === "weeks" ? 7 : 1)
    );
    Object.assign(next, {
      year: wallClock.getUTCFullYear(),
      month: wallClock.getUTCMonth() + 1,
      day: wallClock.getUTCDate()
    });
  } else if (unit === "months") {
    const zeroBased = source.year * 12 + (source.month - 1) + amount;
    const targetYear = Math.floor(zeroBased / 12);
    const targetMonth = ((zeroBased % 12) + 12) % 12 + 1;
    next.year = targetYear;
    next.month = targetMonth;
    next.day = Math.min(source.day, daysInMonth(targetYear, targetMonth));
  } else if (unit === "years") {
    next.year = source.year + amount;
    next.day = Math.min(source.day, daysInMonth(next.year, source.month));
  } else {
    throw dateToolError("UNSUPPORTED_DATE_UNIT", `不支持的日期单位：${unit}`);
  }

  assertValidCalendarParts(next);
  const localIso = [
    String(next.year).padStart(4, "0"),
    String(next.month).padStart(2, "0"),
    String(next.day).padStart(2, "0")
  ].join("-") + "T" + [
    String(next.hour).padStart(2, "0"),
    String(next.minute).padStart(2, "0"),
    String(next.second).padStart(2, "0")
  ].join(":") + `.${String(next.millisecond).padStart(3, "0")}`;

  return parseLocalDateTime(localIso, timeZone);
}

function addDate(date, amount, unit, timeZone) {
  if (["milliseconds", "seconds", "minutes", "hours"].includes(unit)) {
    return addElapsedTime(date, amount, unit);
  }
  return addCalendarTime(date, amount, unit, timeZone);
}

const timeZoneSchema = z.string().trim().min(1).max(100);
const localeSchema = z.string().trim().min(1).max(50);
const dateTimeSchema = z.string().trim().min(1).max(100);

const dateOutputBase = {
  instant: z.string(),
  timeZone: z.string().optional(),
  utcOffset: z.string().optional()
};

export function createDateTimeToolDefinitions() {
  return [
    {
      name: "get_current_time",
      title: "Get current time",
      description:
        "Get the exact current local and UTC date/time. Use this instead of guessing the current date or time.",
      inputSchema: z.object({
        timeZone: timeZoneSchema.optional().describe(
          "Optional IANA time zone such as Asia/Shanghai. Defaults to the user's local time zone."
        ),
        locale: localeSchema.optional()
      }),
      outputSchema: z.object({
        localDateTime: z.string(),
        utcDateTime: z.string(),
        timeZone: z.string(),
        utcOffset: z.string(),
        locale: z.string(),
        unixMilliseconds: z.number().int()
      }),
      async execute({ timeZone, locale }) {
        const now = new Date();
        const zone = validateTimeZone(timeZone || getLocalTimezone());
        const resolvedLocale = validateLocale(locale || getRuntimeLocale());

        return {
          localDateTime: formatDate(now, zone, resolvedLocale),
          utcDateTime: now.toISOString(),
          timeZone: zone,
          utcOffset: formatOffset(now, zone),
          locale: resolvedLocale,
          unixMilliseconds: now.getTime()
        };
      }
    },
    {
      name: "convert_time_zone",
      title: "Convert time zone",
      description:
        "Convert one ISO date/time from a source IANA time zone to a target IANA time zone. Inputs without a UTC offset are interpreted as source-zone wall time and invalid DST-gap times are rejected.",
      inputSchema: z.object({
        dateTime: dateTimeSchema,
        fromTimeZone: timeZoneSchema.optional(),
        toTimeZone: timeZoneSchema,
        locale: localeSchema.optional()
      }),
      outputSchema: z.object({
        source: z.string(),
        converted: z.string(),
        instant: z.string(),
        fromTimeZone: z.string(),
        toTimeZone: z.string(),
        fromUtcOffset: z.string(),
        toUtcOffset: z.string()
      }),
      async execute(input) {
        const fromZone = validateTimeZone(
          input.fromTimeZone || getLocalTimezone()
        );
        const toZone = validateTimeZone(input.toTimeZone);
        const date = parseDateTime(input.dateTime, fromZone, {
          defaultToNow: false
        });
        const locale = validateLocale(input.locale || getRuntimeLocale());

        return {
          source: formatDate(date, fromZone, locale),
          converted: formatDate(date, toZone, locale),
          instant: date.toISOString(),
          fromTimeZone: fromZone,
          toTimeZone: toZone,
          fromUtcOffset: formatOffset(date, fromZone),
          toUtcOffset: formatOffset(date, toZone)
        };
      }
    },
    {
      name: "calculate_date",
      title: "Calculate date",
      description:
        "Add or subtract elapsed time or calendar units, calculate an exact difference between two instants, or determine a weekday. Day/week/month/year arithmetic preserves local wall time in the selected IANA time zone.",
      inputSchema: z.object({
        operation: z.enum(["add", "subtract", "difference", "day_of_week"]),
        dateTime: dateTimeSchema.optional(),
        otherDateTime: dateTimeSchema.optional(),
        amount: z.number().finite().optional(),
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
        timeZone: timeZoneSchema.optional(),
        locale: localeSchema.optional()
      }),
      outputSchema: z.union([
        z.object({
          from: z.string(),
          to: z.string(),
          milliseconds: z.number(),
          seconds: z.number(),
          hours: z.number(),
          days: z.number()
        }),
        z.object({
          ...dateOutputBase,
          formatted: z.string(),
          weekday: z.string()
        }),
        z.object({
          source: z.string(),
          result: z.string(),
          formatted: z.string(),
          timeZone: z.string(),
          utcOffset: z.string(),
          arithmetic: z.enum(["elapsed", "calendar"])
        })
      ]),
      async execute(input) {
        const zone = validateTimeZone(input.timeZone || getLocalTimezone());
        const locale = validateLocale(input.locale || getRuntimeLocale());
        const base = parseDateTime(input.dateTime, zone, {
          defaultToNow: true
        });

        if (input.operation === "difference") {
          if (!input.otherDateTime) {
            throw dateToolError(
              "OTHER_DATE_TIME_REQUIRED",
              "difference 操作需要 otherDateTime。"
            );
          }
          const other = parseDateTime(input.otherDateTime, zone, {
            defaultToNow: false
          });
          const milliseconds = other.getTime() - base.getTime();
          return {
            from: base.toISOString(),
            to: other.toISOString(),
            milliseconds,
            seconds: milliseconds / 1000,
            hours: milliseconds / 3_600_000,
            days: milliseconds / 86_400_000
          };
        }

        if (input.operation === "day_of_week") {
          return {
            instant: base.toISOString(),
            formatted: formatDate(base, zone, locale),
            weekday: new Intl.DateTimeFormat(locale, {
              timeZone: zone,
              weekday: "long"
            }).format(base),
            timeZone: zone,
            utcOffset: formatOffset(base, zone)
          };
        }

        if (!Number.isFinite(input.amount) || !input.unit) {
          throw dateToolError(
            "DATE_AMOUNT_REQUIRED",
            "add/subtract 操作需要 amount 和 unit。"
          );
        }

        const signedAmount = input.operation === "subtract"
          ? -input.amount
          : input.amount;
        const result = addDate(base, signedAmount, input.unit, zone);

        return {
          source: base.toISOString(),
          result: result.toISOString(),
          formatted: formatDate(result, zone, locale),
          timeZone: zone,
          utcOffset: formatOffset(result, zone),
          arithmetic: ["days", "weeks", "months", "years"].includes(input.unit)
            ? "calendar"
            : "elapsed"
        };
      }
    },
    {
      name: "calculator",
      title: "Calculator",
      description:
        "Evaluate a deterministic arithmetic expression. Supports +, -, *, /, %, ^, parentheses, pi, e, and bounded common math functions. Exponentiation follows standard precedence, so -2^2 equals -4.",
      inputSchema: z.object({
        expression: z.string().trim().min(1).max(500)
      }),
      outputSchema: z.object({
        expression: z.string(),
        result: z.number().finite()
      }),
      async execute({ expression }) {
        return {
          expression,
          result: evaluateExpression(expression)
        };
      }
    }
  ];
}

export function getRuntimeSnapshotForTool(options = {}) {
  return createRuntimeSnapshot(options);
}
