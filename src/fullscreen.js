export const fullscreen = {
  available: () =>
    document.fullscreenEnabled || document.webkitFullscreenEnabled,
  enabled: () =>
    document.fullscreenElement != null ||
    document.webkitFullscreenElement != null,
  enter: (el) => {
    if (el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: "hide" });
    } else if (el.webkitRequestFullScreen) {
      el.webkitRequestFullScreen();
    }
  },
  exit: () => {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitCancelFullScreen) {
      document.webkitCancelFullScreen();
    }
  },
  change: (callback) => {
    document.addEventListener(
      "fullscreenchange",
      function () {
        callback();
      },
      false
    );

    document.addEventListener(
      "webkitfullscreenchange",
      function () {
        callback();
      },
      false
    );
  },
};
