const FUNCTIONS = Object.freeze({
  abs: Math.abs,
  sqrt: Math.sqrt,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp,
  min: Math.min,
  max: Math.max,
  pow: Math.pow
});

const CONSTANTS = Object.freeze({
  pi: Math.PI,
  e: Math.E
});

function tokenize(expression) {
  const tokens = [];
  let index = 0;

  while (index < expression.length) {
    const remaining =
      expression.slice(index);

    const whitespace =
      /^\s+/u.exec(remaining);

    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }

    const number =
      /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iu
        .exec(remaining);

    if (number) {
      tokens.push({
        type: "number",
        value: Number(number[0])
      });
      index += number[0].length;
      continue;
    }

    const identifier =
      /^[a-z_][a-z0-9_]*/iu
        .exec(remaining);

    if (identifier) {
      tokens.push({
        type: "identifier",
        value:
          identifier[0]
            .toLowerCase()
      });
      index += identifier[0].length;
      continue;
    }

    const character =
      expression[index];

    if (
      "+-*/%^(),".includes(
        character
      )
    ) {
      tokens.push({
        type: character,
        value: character
      });
      index += 1;
      continue;
    }

    throw new Error(
      `不支持的字符：${character}`
    );
  }

  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
  }

  peek(type = null) {
    const token =
      this.tokens[this.index];

    if (!type) {
      return token;
    }

    return token?.type === type;
  }

  consume(type) {
    if (!this.peek(type)) {
      throw new Error(
        `表达式格式错误，预期 ${type}。`
      );
    }

    const token =
      this.tokens[this.index];

    this.index += 1;
    return token;
  }

  parse() {
    const value =
      this.parseExpression();

    if (this.index < this.tokens.length) {
      throw new Error(
        "表达式末尾存在无法解析的内容。"
      );
    }

    return value;
  }

  parseExpression() {
    let value = this.parseTerm();

    while (
      this.peek("+") ||
      this.peek("-")
    ) {
      const operator =
        this.tokens[this.index++]
          .type;
      const right =
        this.parseTerm();

      value =
        operator === "+"
          ? value + right
          : value - right;
    }

    return value;
  }

  parseTerm() {
    let value = this.parsePower();

    while (
      this.peek("*") ||
      this.peek("/") ||
      this.peek("%")
    ) {
      const operator =
        this.tokens[this.index++]
          .type;
      const right =
        this.parsePower();

      if (
        (operator === "/" ||
          operator === "%") &&
        right === 0
      ) {
        throw new Error(
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
    }

    return value;
  }

  parsePower() {
    let value = this.parseUnary();

    if (this.peek("^")) {
      this.consume("^");
      value = Math.pow(
        value,
        this.parsePower()
      );
    }

    return value;
  }

  parseUnary() {
    if (this.peek("+")) {
      this.consume("+");
      return this.parseUnary();
    }

    if (this.peek("-")) {
      this.consume("-");
      return -this.parseUnary();
    }

    return this.parsePrimary();
  }

  parsePrimary() {
    if (this.peek("number")) {
      return this.consume(
        "number"
      ).value;
    }

    if (this.peek("(")) {
      this.consume("(");
      const value =
        this.parseExpression();
      this.consume(")");
      return value;
    }

    if (this.peek("identifier")) {
      const name =
        this.consume(
          "identifier"
        ).value;

      if (
        Object.hasOwn(
          CONSTANTS,
          name
        ) &&
        !this.peek("(")
      ) {
        return CONSTANTS[name];
      }

      const fn = FUNCTIONS[name];

      if (!fn) {
        throw new Error(
          `不支持的函数或常量：${name}`
        );
      }

      this.consume("(");
      const args = [];

      if (!this.peek(")")) {
        args.push(
          this.parseExpression()
        );

        while (this.peek(",")) {
          this.consume(",");
          args.push(
            this.parseExpression()
          );
        }
      }

      this.consume(")");

      return fn(...args);
    }

    throw new Error(
      "表达式格式错误。"
    );
  }
}

export function evaluateExpression(
  expression
) {
  const source =
    String(expression ?? "")
      .trim();

  if (!source) {
    throw new Error(
      "计算表达式不能为空。"
    );
  }

  if (source.length > 500) {
    throw new Error(
      "计算表达式过长。"
    );
  }

  const result =
    new Parser(
      tokenize(source)
    ).parse();

  if (!Number.isFinite(result)) {
    throw new Error(
      "计算结果不是有限数值。"
    );
  }

  return result;
}
