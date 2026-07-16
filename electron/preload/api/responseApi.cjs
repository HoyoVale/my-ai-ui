const IPC_CHANNELS =
  require(
    "../../shared/ipcChannels.cjs"
  );

const {
  subscribe
} = require(
  "../helpers/subscribe.cjs"
);

function createResponseApi(
  ipcRenderer
) {
  return {
    dismissResponseWindow: () => {
      ipcRenderer.send(
        IPC_CHANNELS
          .response
          .DISMISS_WINDOW
      );
    },

    resizeResponseWindow: (
      size
    ) => {
      if (
        !size ||
        typeof size !==
          "object"
      ) {
        return;
      }

      ipcRenderer.send(
        IPC_CHANNELS
          .response
          .RESIZE_WINDOW,

        {
          width:
            Number(size.width),

          height:
            Number(size.height)
        }
      );
    },

    onResponseStart: (
      callback
    ) => {
      return subscribe(
        ipcRenderer,
        IPC_CHANNELS
          .response
          .STREAM_START,
        callback,
        () => undefined
      );
    },

    onResponseChunk: (
      callback
    ) => {
      return subscribe(
        ipcRenderer,
        IPC_CHANNELS
          .response
          .STREAM_CHUNK,
        callback,
        (chunk) =>
          String(chunk ?? "")
      );
    },

    onResponseEnd: (
      callback
    ) => {
      return subscribe(
        ipcRenderer,
        IPC_CHANNELS
          .response
          .STREAM_END,
        callback,
        () => undefined
      );
    },

    onResponseClear: (
      callback
    ) => {
      return subscribe(
        ipcRenderer,
        IPC_CHANNELS
          .response
          .STREAM_CLEAR,
        callback,
        () => undefined
      );
    },

    onResponseSideChange: (
      callback
    ) => {
      return subscribe(
        ipcRenderer,
        IPC_CHANNELS
          .response
          .SIDE_CHANGED,
        callback,
        (side) =>
          side === "left"
            ? "left"
            : "right"
      );
    }
  };
}

module.exports = {
  createResponseApi
};
