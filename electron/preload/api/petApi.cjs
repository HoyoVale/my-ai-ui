const IPC_CHANNELS =
  require(
    "../../shared/ipcChannels.cjs"
  );

function normalizePoint(point) {
  return {
    x: Number(point?.x),
    y: Number(point?.y)
  };
}

function createPetApi(
  ipcRenderer
) {
  return {
    startPetDrag: (point) => {
      ipcRenderer.send(
        IPC_CHANNELS
          .pet
          .DRAG_START,

        normalizePoint(point)
      );
    },

    movePetDrag: (point) => {
      ipcRenderer.send(
        IPC_CHANNELS
          .pet
          .DRAG_MOVE,

        normalizePoint(point)
      );
    },

    endPetDrag: () => {
      ipcRenderer.send(
        IPC_CHANNELS
          .pet
          .DRAG_END
      );
    }
  };
}

module.exports = {
  createPetApi
};
