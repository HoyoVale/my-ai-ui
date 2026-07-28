import {
  PRODUCT_NAME,
  resolveReleaseChannel
} from "../../src/shared/releaseIdentity.js";

const UPDATE_STATE_VERSION = 1;
const DEFAULT_STARTUP_DELAY_MS = 20_000;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

function cleanText(value, limit = 500) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);
}

function initialState(application) {
  const currentVersion = cleanText(
    application?.getVersion?.() ?? "0.0.0",
    80
  );

  return {
    schemaVersion: UPDATE_STATE_VERSION,
    supported: false,
    status: "disabled",
    reason: "not-initialized",
    currentVersion,
    availableVersion: "",
    downloadedVersion: "",
    channel: resolveReleaseChannel(
      currentVersion,
      process.env.XIXI_UPDATE_CHANNEL ?? ""
    ),
    progressPercent: 0,
    bytesPerSecond: 0,
    transferred: 0,
    total: 0,
    errorCode: "",
    errorMessage: "",
    checkedAt: "",
    updatedAt: new Date().toISOString()
  };
}

function updaterFromModule(module) {
  return module?.autoUpdater ??
    module?.default?.autoUpdater ??
    module?.default ??
    null;
}

function normalizedVersion(info) {
  return cleanText(
    info?.version ??
    info?.updateInfo?.version ??
    "",
    80
  );
}

export class UpdateService {
  constructor({
    application,
    notificationClass,
    loadUpdater = () => import("electron-updater"),
    logger = console,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    startupDelayMs = DEFAULT_STARTUP_DELAY_MS,
    intervalMs = DEFAULT_INTERVAL_MS
  } = {}) {
    this.application = application;
    this.notificationClass = notificationClass;
    this.loadUpdater = loadUpdater;
    this.logger = logger;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.startupDelayMs = startupDelayMs;
    this.intervalMs = intervalMs;

    this.state = initialState(application);
    this.listeners = new Set();
    this.updater = null;
    this.initialized = false;
    this.initializing = null;
    this.checkPromise = null;
    this.startupTimer = null;
    this.intervalTimer = null;
    this.boundEvents = [];
  }

  getState() {
    return structuredClone(this.state);
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }

    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(patch) {
    this.state = {
      ...this.state,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    const snapshot = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.logger.warn?.(
          "更新状态监听器执行失败：",
          error
        );
      }
    }

    return snapshot;
  }

  bind(eventName, handler) {
    this.updater.on(eventName, handler);
    this.boundEvents.push([
      eventName,
      handler
    ]);
  }

  notify(title, body) {
    try {
      if (
        !this.notificationClass?.isSupported?.()
      ) {
        return;
      }

      new this.notificationClass({
        title,
        body,
        silent: false
      }).show();
    } catch (error) {
      this.logger.warn?.(
        "显示更新通知失败：",
        error
      );
    }
  }

  async initialize({
    schedule = true
  } = {}) {
    if (this.initialized) {
      return this.getState();
    }

    if (this.initializing) {
      return this.initializing;
    }

    this.initializing = this.initializeOnce({
      schedule
    }).finally(() => {
      this.initializing = null;
    });

    return this.initializing;
  }

  async initializeOnce({ schedule }) {
    this.initialized = true;

    if (!this.application?.isPackaged) {
      return this.publish({
        supported: false,
        status: "disabled",
        reason: "development-mode"
      });
    }

    if (process.env.XIXI_DISABLE_AUTO_UPDATE === "1") {
      return this.publish({
        supported: false,
        status: "disabled",
        reason: "disabled-by-environment"
      });
    }

    try {
      const module = await this.loadUpdater();
      this.updater = updaterFromModule(module);
    } catch (error) {
      this.logger.warn?.(
        "自动更新模块不可用：",
        error
      );
    }

    if (!this.updater) {
      return this.publish({
        supported: false,
        status: "disabled",
        reason: "updater-module-unavailable"
      });
    }

    this.updater.autoDownload = true;
    this.updater.autoInstallOnAppQuit = true;
    this.updater.allowPrerelease =
      this.state.channel !== "stable";

    try {
      this.updater.channel =
        this.state.channel;
    } catch {
      // Older provider adapters may expose channel as read-only.
    }

    this.bind(
      "checking-for-update",
      () => {
        this.publish({
          supported: true,
          status: "checking",
          reason: "",
          errorCode: "",
          errorMessage: ""
        });
      }
    );

    this.bind(
      "update-available",
      (info) => {
        const version = normalizedVersion(info);
        this.publish({
          supported: true,
          status: "available",
          availableVersion: version,
          progressPercent: 0,
          checkedAt: new Date().toISOString(),
          errorCode: "",
          errorMessage: ""
        });
        this.notify(
          `${PRODUCT_NAME} 有可用更新`,
          version
            ? `版本 ${version} 正在下载。`
            : "新版本正在下载。"
        );
      }
    );

    this.bind(
      "update-not-available",
      (info) => {
        this.publish({
          supported: true,
          status: "not-available",
          availableVersion: normalizedVersion(info),
          progressPercent: 0,
          checkedAt: new Date().toISOString(),
          errorCode: "",
          errorMessage: ""
        });
      }
    );

    this.bind(
      "download-progress",
      (progress = {}) => {
        this.publish({
          supported: true,
          status: "downloading",
          progressPercent: Math.max(
            0,
            Math.min(
              100,
              Number(progress.percent) || 0
            )
          ),
          bytesPerSecond:
            Math.max(
              0,
              Number(progress.bytesPerSecond) || 0
            ),
          transferred:
            Math.max(
              0,
              Number(progress.transferred) || 0
            ),
          total:
            Math.max(
              0,
              Number(progress.total) || 0
            )
        });
      }
    );

    this.bind(
      "update-downloaded",
      (info) => {
        const version = normalizedVersion(info);
        this.publish({
          supported: true,
          status: "downloaded",
          downloadedVersion: version,
          availableVersion:
            version ||
            this.state.availableVersion,
          progressPercent: 100,
          errorCode: "",
          errorMessage: ""
        });
        this.notify(
          `${PRODUCT_NAME} 更新已下载`,
          "可以从关于页面或托盘菜单安装并重启。"
        );
      }
    );

    this.bind(
      "error",
      (error) => {
        this.publish({
          supported: true,
          status: "error",
          errorCode:
            cleanText(
              error?.code ??
              error?.name ??
              "update-error",
              80
            ) ||
            "update-error",
          errorMessage:
            cleanText(
              error?.message ??
              "检查更新时发生错误。"
            ) ||
            "检查更新时发生错误。"
        });
      }
    );

    const state = this.publish({
      supported: true,
      status: "idle",
      reason: "",
      errorCode: "",
      errorMessage: ""
    });

    if (schedule) {
      this.startupTimer = this.setTimeoutFn(
        () => {
          void this.checkForUpdates({
            manual: false
          });
        },
        this.startupDelayMs
      );
      this.startupTimer?.unref?.();

      this.intervalTimer = this.setIntervalFn(
        () => {
          void this.checkForUpdates({
            manual: false
          });
        },
        this.intervalMs
      );
      this.intervalTimer?.unref?.();
    }

    return state;
  }

  async checkForUpdates({
    manual = true
  } = {}) {
    await this.initialize();

    if (!this.updater) {
      return {
        ok: false,
        code: this.state.reason || "updates-unavailable",
        state: this.getState()
      };
    }

    if (this.checkPromise) {
      return this.checkPromise;
    }

    this.publish({
      status: "checking",
      reason: "",
      errorCode: "",
      errorMessage: ""
    });

    this.checkPromise = Promise.resolve()
      .then(() => this.updater.checkForUpdates())
      .then((result) => ({
        ok: true,
        code: manual
          ? "manual-check-complete"
          : "scheduled-check-complete",
        updateInfo: result?.updateInfo ?? null,
        state: this.getState()
      }))
      .catch((error) => {
        const errorMessage =
          cleanText(error?.message) ||
          "检查更新失败。";

        this.publish({
          status: "error",
          errorCode:
            cleanText(
              error?.code ??
              error?.name ??
              "update-check-failed",
              80
            ),
          errorMessage
        });

        return {
          ok: false,
          code: "update-check-failed",
          message: errorMessage,
          state: this.getState()
        };
      })
      .finally(() => {
        this.checkPromise = null;
      });

    return this.checkPromise;
  }

  async downloadUpdate() {
    await this.initialize();

    if (!this.updater) {
      return {
        ok: false,
        code: "updates-unavailable",
        state: this.getState()
      };
    }

    try {
      this.publish({
        status: "downloading",
        errorCode: "",
        errorMessage: ""
      });
      await this.updater.downloadUpdate();
      return {
        ok: true,
        code: "update-download-started",
        state: this.getState()
      };
    } catch (error) {
      const message =
        cleanText(error?.message) ||
        "下载更新失败。";
      this.publish({
        status: "error",
        errorCode: "update-download-failed",
        errorMessage: message
      });
      return {
        ok: false,
        code: "update-download-failed",
        message,
        state: this.getState()
      };
    }
  }

  installUpdate() {
    if (
      !this.updater ||
      this.state.status !== "downloaded"
    ) {
      return {
        ok: false,
        code: "update-not-downloaded",
        state: this.getState()
      };
    }

    this.publish({
      status: "installing",
      errorCode: "",
      errorMessage: ""
    });

    this.updater.quitAndInstall(
      false,
      true
    );

    return {
      ok: true,
      code: "update-installing",
      state: this.getState()
    };
  }

  async shutdown() {
    if (this.startupTimer) {
      this.clearTimeoutFn(
        this.startupTimer
      );
      this.startupTimer = null;
    }

    if (this.intervalTimer) {
      this.clearIntervalFn(
        this.intervalTimer
      );
      this.intervalTimer = null;
    }

    if (this.updater) {
      for (const [eventName, handler] of this.boundEvents) {
        this.updater.removeListener?.(
          eventName,
          handler
        );
      }
    }

    this.boundEvents = [];
    this.listeners.clear();
  }
}
