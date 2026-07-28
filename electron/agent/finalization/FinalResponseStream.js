function textValue(value) {
  return String(value ?? "");
}

export class FinalResponseStream {
  constructor({
    isActive = () => true,
    onAppend = () => {},
    onReplace = () => {},
    onText = () => {}
  } = {}) {
    this.isActive = isActive;
    this.onAppend = onAppend;
    this.onReplace = onReplace;
    this.onText = onText;
    this.text = "";
  }

  snapshot() {
    return this.text;
  }

  reset() {
    this.text = "";
    if (!this.isActive()) {
      return false;
    }

    this.onText("");
    this.onReplace("");
    return true;
  }

  append(chunk) {
    const value = textValue(chunk);
    if (!value || !this.isActive()) {
      return "";
    }

    this.text += value;
    this.onText(this.text);
    this.onAppend(value);
    return value;
  }

  commit(value) {
    const next = textValue(value);
    const previous = this.text;
    this.text = next;

    if (!this.isActive()) {
      return {
        changed: previous !== next,
        operation: "inactive",
        text: next
      };
    }

    this.onText(next);
    if (next !== previous) {
      this.onReplace(next);
      return {
        changed: true,
        operation: "replace",
        text: next
      };
    }

    return {
      changed: false,
      operation: "none",
      text: next
    };
  }
}
