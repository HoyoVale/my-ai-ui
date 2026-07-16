function subscribe(
  ipcRenderer,
  channel,
  callback,
  transform = (...args) =>
    args[0]
) {
  if (
    typeof callback !==
    "function"
  ) {
    return () => {};
  }

  const handler = (
    _event,
    ...args
  ) => {
    callback(
      transform(...args)
    );
  };

  ipcRenderer.on(
    channel,
    handler
  );

  return () => {
    ipcRenderer.removeListener(
      channel,
      handler
    );
  };
}

module.exports = {
  subscribe
};
