const IPC_CHANNELS =
  require(
    "../../shared/ipcChannels.cjs"
  );

const {
  subscribe
} = require(
  "../helpers/subscribe.cjs"
);

function createWindowApi(
  ipcRenderer
) {
  return {
    minimizeWindow: () => {
      ipcRenderer.send(
        IPC_CHANNELS
          .window
          .MINIMIZE
      );
    },

    maximizeWindow: () => {
      ipcRenderer.send(
        IPC_CHANNELS
          .window
          .TOGGLE_MAXIMIZE
      );
    },

    closeWindow: () => {
      ipcRenderer.send(
        IPC_CHANNELS
          .window
          .CLOSE
      );
    },

    isMaximized: () => {
      return ipcRenderer.invoke(
        IPC_CHANNELS
          .window
          .IS_MAXIMIZED
      );
    },

    onWindowStateChange: (
      callback
    ) => {
      return subscribe(
        ipcRenderer,
        IPC_CHANNELS
          .window
          .STATE_CHANGED,
        callback,
        (isMaximized) =>
          Boolean(
            isMaximized
          )
      );
    },

    setMouseThrough: (
      shouldIgnore
    ) => {
      ipcRenderer.send(
        IPC_CHANNELS
          .window
          .SET_MOUSE_THROUGH,

        Boolean(
          shouldIgnore
        )
      );
    }
  };
}

module.exports = {
  createWindowApi
};
