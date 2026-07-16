const IPC_CHANNELS =
  require(
    "../../shared/ipcChannels.cjs"
  );

function createNavigationApi(
  ipcRenderer
) {
  return {
    openInput: () => {
      ipcRenderer.send(
        IPC_CHANNELS
          .navigation
          .OPEN_INPUT
      );
    },

    openResponse: () => {
      ipcRenderer.send(
        IPC_CHANNELS
          .navigation
          .OPEN_RESPONSE
      );
    },

    openSetting: () => {
      ipcRenderer.send(
        IPC_CHANNELS
          .navigation
          .OPEN_SETTING
      );
    }
  };
}

module.exports = {
  createNavigationApi
};
