export const RESPONSE_REPLAY_STATES = Object.freeze({
  IDLE: "idle",
  STREAMING: "streaming",
  ENDED: "ended",
  CLEARED: "cleared"
});

function boundedLength(value, fallback = 4_000_000) {
  const normalized = Math.round(Number(value));
  return Number.isFinite(normalized)
    ? Math.max(1_024, normalized)
    : fallback;
}

export class ResponseStreamReplayBuffer {
  constructor({ maxTextLength = 4_000_000 } = {}) {
    this.maxTextLength = boundedLength(maxTextLength);
    this.state = RESPONSE_REPLAY_STATES.IDLE;
    this.text = "";
    this.truncated = false;
    this.revision = 0;
  }

  start() {
    this.state = RESPONSE_REPLAY_STATES.STREAMING;
    this.text = "";
    this.truncated = false;
    this.revision += 1;
  }

  append(chunk) {
    const text = String(chunk ?? "");
    if (!text) {
      return false;
    }
    if (this.state !== RESPONSE_REPLAY_STATES.STREAMING) {
      this.start();
    }
    const remaining = this.maxTextLength - this.text.length;
    if (remaining <= 0) {
      this.truncated = true;
      return false;
    }
    this.text += text.slice(0, remaining);
    this.truncated = this.truncated || text.length > remaining;
    this.revision += 1;
    return true;
  }

  replace(value) {
    const text = String(value ?? "");
    this.state = text
      ? RESPONSE_REPLAY_STATES.STREAMING
      : RESPONSE_REPLAY_STATES.CLEARED;
    this.text = text.slice(0, this.maxTextLength);
    this.truncated = text.length > this.maxTextLength;
    this.revision += 1;
  }

  end() {
    if (this.state === RESPONSE_REPLAY_STATES.IDLE) {
      return false;
    }
    if (this.state !== RESPONSE_REPLAY_STATES.CLEARED) {
      this.state = RESPONSE_REPLAY_STATES.ENDED;
    }
    this.revision += 1;
    return true;
  }

  clear() {
    this.state = RESPONSE_REPLAY_STATES.CLEARED;
    this.text = "";
    this.truncated = false;
    this.revision += 1;
  }

  reset() {
    this.state = RESPONSE_REPLAY_STATES.IDLE;
    this.text = "";
    this.truncated = false;
    this.revision += 1;
  }

  isStreamChannel(channel, channels) {
    return [
      channels.STREAM_START,
      channels.STREAM_CHUNK,
      channels.STREAM_REPLACE,
      channels.STREAM_END,
      channels.STREAM_CLEAR
    ].includes(channel);
  }

  replayMessages(channels) {
    if (this.state === RESPONSE_REPLAY_STATES.IDLE) {
      return [];
    }
    if (this.state === RESPONSE_REPLAY_STATES.CLEARED) {
      return [{ channel: channels.STREAM_CLEAR, args: [] }];
    }

    const messages = [
      { channel: channels.STREAM_START, args: [] },
      { channel: channels.STREAM_REPLACE, args: [this.text] }
    ];
    if (this.state === RESPONSE_REPLAY_STATES.ENDED) {
      messages.push({ channel: channels.STREAM_END, args: [] });
    }
    return messages;
  }

  snapshot() {
    return {
      state: this.state,
      textLength: this.text.length,
      truncated: this.truncated,
      revision: this.revision
    };
  }
}
