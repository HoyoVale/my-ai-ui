function clone(value) {
  return structuredClone(value);
}

export class ToolAuditLog {
  constructor() {
    this.records = [];
  }

  upsert(record) {
    const index =
      this.records.findIndex(
        (item) =>
          item.id === record.id
      );

    if (index >= 0) {
      this.records[index] = {
        ...this.records[index],
        ...clone(record)
      };
    } else {
      this.records.push(
        clone(record)
      );
    }

    return clone(record);
  }

  list() {
    return clone(this.records);
  }
}
