const FUNCTION_DEFINITIONS = Object.freeze({
  abs: { fn: Math.abs, minArgs: 1, maxArgs: 1 },
  sqrt: { fn: Math.sqrt, minArgs: 1, maxArgs: 1 },
  round: { fn: Math.round, minArgs: 1, maxArgs: 1 },
  floor: { fn: Math.floor, minArgs: 1, maxArgs: 1 },
  ceil: { fn: Math.ceil, minArgs: 1, maxArgs: 1 },
  sin: { fn: Math.sin, minArgs: 1, maxArgs: 1 },
  cos: { fn: Math.cos, minArgs: 1, maxArgs: 1 },
  tan: { fn: Math.tan, minArgs: 1, maxArgs: 1 },
  asin: { fn: Math.asin, minArgs: 1, maxArgs: 1 },
  acos: { fn: Math.acos, minArgs: 1, maxArgs: 1 },
  atan: { fn: Math.atan, minArgs: 1, maxArgs: 1 },
  log: { fn: Math.log10, minArgs: 1, maxArgs: 1 },
  ln: { fn: Math.log, minArgs: 1, maxArgs: 1 },
  exp: { fn: Math.exp, minArgs: 1, maxArgs: 1 },
  min: { fn: Math.min, minArgs: 1, maxArgs: 32 },
  max: { fn: Math.max, minArgs: 1, maxArgs: 32 },
  pow: { fn: Math.pow, minArgs: 2, maxArgs: 2 }
});

const CONSTANTS = Object.freeze({
  pi: Math.PI,
  e: Math.E
});

const MAX_EXPRESSION_LENGTH = 500;
const MAX_TOKENS = 256;
const MAX_PARSE_DEPTH = 64;

function calculatorError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function tokenize(expression) {
  const tokens = [];
  let index = 0;

  while (index < expression.length) {
    const remaining = expression.slice(index);
    const whitespace = /^\s+/u.exec(remaining);

    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }

    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iu.exec(
      remaining
    );

    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) {
        throw calculatorError(
          "CALCULATOR_NUMBER_OUT_OF_RANGE",
          `数值超出可计算范围：${number[0]}`
        );
      }
      tokens.push({ type: "number", value });
      index += number[0].length;
    } else {
      const identifier = /^[a-z_][a-z0-9_]*/iu.exec(remaining);
      if (identifier) {
        tokens.push({
          type: "identifier",
          value: identifier[0].toLowerCase()
        });
        index += identifier[0].length;
      } else {
        const character = expression[index];
        if (!"+-*/%^(),".includes(character)) {
          throw calculatorError(
            "CALCULATOR_UNSUPPORTED_CHARACTER",
            `不支持的字符：${character}`
          );
        }
        tokens.push({ type: character, value: character });
        index += 1;
      }
    }

    if (tokens.length > MAX_TOKENS) {
      throw calculatorError(
        "CALCULATOR_TOO_COMPLEX",
        "计算表达式包含的符号过多。"
      );
    }
  }

  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
    this.depth = 0;
  }

  withDepth(callback) {
    this.depth += 1;
    if (this.depth > MAX_PARSE_DEPTH) {
      this.depth -= 1;
      throw calculatorError(
        "CALCULATOR_TOO_COMPLEX",
        "计算表达式嵌套过深。"
      );
    }

    try {
      return callback();
    } finally {
      this.depth -= 1;
    }
  }

  peek(type = null) {
    const token = this.tokens[this.index];
    return type ? token?.type === type : token;
  }

  consume(type) {
    if (!this.peek(type)) {
      throw calculatorError(
        "CALCULATOR_SYNTAX_ERROR",
        `表达式格式错误，预期 ${type}。`
      );
    }

    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  parse() {
    if (this.tokens.length === 0) {
      throw calculatorError(
        "CALCULATOR_EMPTY_EXPRESSION",
        "计算表达式不能为空。"
      );
    }

    const value = this.parseExpression();
    if (this.index < this.tokens.length) {
      throw calculatorError(
        "CALCULATOR_SYNTAX_ERROR",
        "表达式末尾存在无法解析的内容。"
      );
    }
    return value;
  }

  parseExpression() {
    let value = this.parseTerm();

    while (this.peek("+") || this.peek("-")) {
      const operator = this.tokens[this.index++].type;
      const right = this.parseTerm();
      value = operator === "+" ? value + right : value - right;
      this.assertFinite(value);
    }

    return value;
  }

  parseTerm() {
    let value = this.parseUnary();

    while (this.peek("*") || this.peek("/") || this.peek("%")) {
      const operator = this.tokens[this.index++].type;
      const right = this.parseUnary();

      if ((operator === "/" || operator === "%") && right === 0) {
        throw calculatorError(
          "CALCULATOR_DIVIDE_BY_ZERO",
          "不能除以零。"
        );
      }

      if (operator === "*") {
        value *= right;
      } else if (operator === "/") {
        value /= right;
      } else {
        value %= right;
      }
      this.assertFinite(value);
    }

    return value;
  }

  // Unary signs have lower precedence than exponentiation, so -2^2 = -(2^2).
  parseUnary() {
    if (this.peek("+")) {
      this.consume("+");
      return this.withDepth(() => this.parseUnary());
    }

    if (this.peek("-")) {
      this.consume("-");
      return -this.withDepth(() => this.parseUnary());
    }

    return this.parsePower();
  }

  parsePower() {
    let value = this.parsePrimary();

    if (this.peek("^")) {
      this.consume("^");
      const exponent = this.withDepth(() => this.parseUnary());
      value = Math.pow(value, exponent);
      this.assertFinite(value);
    }

    return value;
  }

  parsePrimary() {
    if (this.peek("number")) {
      return this.consume("number").value;
    }

    if (this.peek("(")) {
      this.consume("(");
      const value = this.withDepth(() => this.parseExpression());
      this.consume(")");
      return value;
    }

    if (this.peek("identifier")) {
      const name = this.consume("identifier").value;

      if (Object.hasOwn(CONSTANTS, name) && !this.peek("(")) {
        return CONSTANTS[name];
      }

      const definition = FUNCTION_DEFINITIONS[name];
      if (!definition) {
        throw calculatorError(
          "CALCULATOR_UNSUPPORTED_FUNCTION",
          `不支持的函数或常量：${name}`
        );
      }

      this.consume("(");
      const args = [];
      if (!this.peek(")")) {
        args.push(this.withDepth(() => this.parseExpression()));
        while (this.peek(",")) {
          this.consume(",");
          if (args.length >= definition.maxArgs) {
            throw calculatorError(
              "CALCULATOR_INVALID_ARITY",
              `函数 ${name} 的参数过多。`
            );
          }
          args.push(this.withDepth(() => this.parseExpression()));
        }
      }
      this.consume(")");

      if (
        args.length < definition.minArgs ||
        args.length > definition.maxArgs
      ) {
        const expected = definition.minArgs === definition.maxArgs
          ? `${definition.minArgs}`
          : `${definition.minArgs}-${definition.maxArgs}`;
        throw calculatorError(
          "CALCULATOR_INVALID_ARITY",
          `函数 ${name} 需要 ${expected} 个参数，实际收到 ${args.length} 个。`
        );
      }

      const value = definition.fn(...args);
      this.assertFinite(value, `函数 ${name} 的输入超出定义域或结果溢出。`);
      return value;
    }

    throw calculatorError(
      "CALCULATOR_SYNTAX_ERROR",
      "表达式格式错误。"
    );
  }

  assertFinite(value, message = "计算结果不是有限数值。") {
    if (!Number.isFinite(value)) {
      throw calculatorError("CALCULATOR_NON_FINITE_RESULT", message);
    }
  }
}

export function evaluateExpression(expression) {
  const source = String(expression ?? "").trim();

  if (!source) {
    throw calculatorError(
      "CALCULATOR_EMPTY_EXPRESSION",
      "计算表达式不能为空。"
    );
  }

  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw calculatorError(
      "CALCULATOR_EXPRESSION_TOO_LONG",
      "计算表达式过长。"
    );
  }

  return new Parser(tokenize(source)).parse();
}
