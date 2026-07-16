const IPC_CHANNELS =
  require(
    "../../shared/ipcChannels.cjs"
  );

function createInputApi(
  ipcRenderer
) {
  return {
    resizeInputWindow: (
      height
    ) => {
      ipcRenderer.send(
        IPC_CHANNELS
          .input
          .RESIZE_WINDOW,

        Number(height)
      );
    }
  };
}

module.exports = {
  createInputApi
};
