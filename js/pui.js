
(() => {
  const tile = document.querySelector(".puiTile");
  const video = tile?.querySelector("video.pui");
  const display = tile?.querySelector(".puiDisplay");
  const displayContext = display?.getContext("2d");
  const canvas = tile?.querySelector(".puiViewer");
  const media = tile?.querySelector(".puiMedia");
  const status = tile?.querySelector(".puiViewerStatus");

  if (!video || !displayContext) {
    return;
  }

  const videoFps = 48;
  const otherHoverFrame = 22;
  const rendererUrl = new URL("pui-4dgs.js?v=20261025-12", document.currentScript.src).href;
  const canUseHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  let currentFrame = 0;
  let targetFrame = 0;
  let timer = 0;
  let videoAnimationFrame = 0;
  let playbackRevision = 0;
  let isVideoAnimating = false;
  const videoFrames = [];
  let videoFramesPromise;
  let isOtherImageSelected = false;
  let shouldHoldOtherFrame = false;
  let isSelected = false;
  let isPlayingSelf = false;
  let isFinishingSelf = false;
  let finishDirection = 1;
  let lastTouchActivation = Number.NEGATIVE_INFINITY;
  let viewer;
  let viewerPromise;
  let rendererPromise;
  let viewerActivation = 0;
  let isReturningToFront = false;
  let cancelVideoHandoff;

  const presentFrame = (source) => {
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(media.clientWidth * pixelRatio));
    const height = Math.max(1, Math.round(media.clientHeight * pixelRatio));
    if (display.width !== width || display.height !== height) {
      display.width = width;
      display.height = height;
    }
    displayContext.globalCompositeOperation = "copy";
    displayContext.drawImage(source, 0, 0, width, height);
  };

  const isVideoFrameReady = () => Boolean(videoFrames[currentFrame])
    || (video.readyState >= 2 && !video.seeking);

  const presentVideoFrame = () => {
    if (canvas.hidden && isVideoFrameReady()) {
      presentFrame(videoFrames[currentFrame] || video);
    }
  };

  const showFrame = () => {
    if (!videoFrames[currentFrame] && (canvas.hidden || isReturningToFront) && video.readyState >= 1) {
      const time = (currentFrame + 0.5) / videoFps;
      if (Math.abs(video.currentTime - time) > 0.000001) {
        video.currentTime = time;
      }
    }
    presentVideoFrame();
    if (!isReturningToFront) {
      viewer?.setFrame(currentFrame);
    }
  };

  const loadVideoFrames = () => {
    if (!videoFramesPromise) {
      videoFramesPromise = (async () => {
        const decoder = document.createElement("video");
        decoder.muted = true;
        decoder.playsInline = true;
        decoder.preload = "auto";
        try {
          await new Promise((resolve, reject) => {
            const cleanup = () => {
              decoder.removeEventListener("loadedmetadata", ready);
              decoder.removeEventListener("error", fail);
            };
            const ready = () => {
              cleanup();
              resolve();
            };
            const fail = () => {
              cleanup();
              reject(new Error("動画を読み込めませんでした。"));
            };
            decoder.addEventListener("loadedmetadata", ready);
            decoder.addEventListener("error", fail);
            decoder.src = video.currentSrc || video.src;
            decoder.load();
          });
          for (let frame = 0; frame < 48; frame++) {
            await new Promise((resolve, reject) => {
              const cleanup = () => {
                decoder.removeEventListener("seeked", ready);
                decoder.removeEventListener("loadeddata", ready);
                decoder.removeEventListener("error", fail);
              };
              const ready = () => {
                if (decoder.readyState >= 2 && !decoder.seeking) {
                  cleanup();
                  resolve();
                }
              };
              const fail = () => {
                cleanup();
                reject(new Error("動画のフレームを読み込めませんでした。"));
              };
              decoder.addEventListener("seeked", ready);
              decoder.addEventListener("loadeddata", ready);
              decoder.addEventListener("error", fail);
              decoder.currentTime = (frame + 0.5) / videoFps;
              ready();
            });
            const image = document.createElement("canvas");
            image.width = decoder.videoWidth;
            image.height = decoder.videoHeight;
            image.getContext("2d").drawImage(decoder, 0, 0);
            videoFrames[frame] = image;
          }
        } finally {
          decoder.pause();
          decoder.removeAttribute("src");
          decoder.load();
        }
      })().catch((error) => {
        videoFramesPromise = undefined;
        throw error;
      });
    }
    return videoFramesPromise;
  };

  video.addEventListener("loadeddata", showFrame);
  video.addEventListener("seeked", presentVideoFrame);
  showFrame();
  loadVideoFrames().catch((error) => console.error(error));

  const stopPlayback = () => {
    playbackRevision += 1;
    window.clearInterval(timer);
    cancelAnimationFrame(videoAnimationFrame);
    video.pause();
    timer = 0;
    videoAnimationFrame = 0;
    isVideoAnimating = false;
  };

  const advanceFrame = () => {
    if (isPlayingSelf && currentFrame === 47) {
      currentFrame = 0;
      showFrame();
      if (!viewer) {
        isPlayingSelf = false;
        stopPlayback();
      }
      return;
    }

    currentFrame += Math.sign(targetFrame - currentFrame);
    showFrame();

    if (!isPlayingSelf && currentFrame === targetFrame) {
      stopPlayback();
    }
  };

  const playVideoFrames = (revision) => {
    loadVideoFrames().then(() => {
      if (revision !== playbackRevision) {
        return;
      }
      const firstFrame = currentFrame;
      const direction = isFinishingSelf ? finishDirection : Math.sign(targetFrame - firstFrame) || 1;
      const wrapsToStart = isPlayingSelf || (isFinishingSelf && direction > 0);
      const distance = wrapsToStart ? 48 - firstFrame : Math.abs(targetFrame - firstFrame);
      const lastFrame = wrapsToStart ? 0 : targetFrame;
      const start = performance.now();
      const draw = (now) => {
        if (revision !== playbackRevision) {
          return;
        }
        const steps = Math.min(distance, Math.floor((now - start) * videoFps / 1000));
        const frame = (firstFrame + direction * steps + 48) % 48;
        if (frame !== currentFrame) {
          currentFrame = frame;
          showFrame();
        }
        if (steps === distance) {
          stopPlayback();
          currentFrame = lastFrame;
          targetFrame = lastFrame;
          isFinishingSelf = false;
          isPlayingSelf = false;
          showFrame();
          return;
        }
        videoAnimationFrame = requestAnimationFrame(draw);
      };
      presentVideoFrame();
      videoAnimationFrame = requestAnimationFrame(draw);
    }).catch((error) => {
      if (revision === playbackRevision) {
        stopPlayback();
        status.textContent = "動画を読み込めませんでした。";
        status.hidden = false;
      }
      console.error(error);
    });
  };

  const playTo = (frame) => {
    if (isVideoAnimating && targetFrame === frame && !isPlayingSelf) {
      return;
    }
    stopPlayback();
    targetFrame = frame;
    if (isPlayingSelf || currentFrame !== targetFrame) {
      if (isPlayingSelf && viewer) {
        timer = window.setInterval(advanceFrame, 1000 / viewer.fps);
      } else {
        isVideoAnimating = true;
        playVideoFrames(playbackRevision);
      }
    }
  };

  const hideViewer = () => {
    viewerActivation += 1;
    cancelVideoHandoff?.();
    isReturningToFront = false;
    viewer?.setActive(false);
    canvas.hidden = true;
    media.classList.remove("isViewerActive");
    status.hidden = true;
    presentVideoFrame();
  };

  const finishWithVideo = () => {
    if (shouldHoldOtherFrame) {
      isFinishingSelf = false;
      playTo(otherHoverFrame);
      return;
    }
    isFinishingSelf = currentFrame !== 0;
    finishDirection = currentFrame <= 48 - currentFrame ? -1 : 1;
    playTo(0);
  };

  const returnViewerToFront = () => {
    if (isReturningToFront) {
      return true;
    }
    if (!viewer || canvas.hidden) {
      hideViewer();
      return false;
    }
    const activation = ++viewerActivation;
    stopPlayback();
    currentFrame = viewer.getFrame();
    viewer.setFrame(currentFrame);
    isReturningToFront = true;
    status.hidden = true;
    showFrame();
    viewer.resetCamera().then((complete) => {
      if (!complete || activation !== viewerActivation) {
        return;
      }
      const finish = () => {
        requestAnimationFrame(() => {
          if (activation !== viewerActivation) {
            return;
          }
          hideViewer();
          const videoActivation = viewerActivation;
          requestAnimationFrame(() => {
            if (videoActivation === viewerActivation && !isSelected) {
              finishWithVideo();
            }
          });
        });
      };
      if (isVideoFrameReady()) {
        finish();
        return;
      }
      const cleanup = () => {
        video.removeEventListener("seeked", handleReady);
        video.removeEventListener("loadeddata", handleReady);
        cancelVideoHandoff = undefined;
      };
      const handleReady = () => {
        if (isVideoFrameReady()) {
          cleanup();
          if (activation === viewerActivation) {
            finish();
          }
        }
      };
      cancelVideoHandoff = cleanup;
      video.addEventListener("seeked", handleReady);
      video.addEventListener("loadeddata", handleReady);
    });
    return true;
  };

  const showViewerError = (error) => {
    hideViewer();
    viewerPromise = undefined;
    viewer = undefined;
    if (isPlayingSelf) {
      playTo(47);
    }
    if (isSelected) {
      status.textContent = "GSを表示できませんでした。";
      status.hidden = false;
    }
    console.error(error);
  };

  const loadRenderer = () => {
    if (!rendererPromise) {
      rendererPromise = new Promise((resolve, reject) => {
        if (window.createPuiGs) {
          resolve();
          return;
        }
        const script = document.createElement("script");
        script.src = rendererUrl;
        script.onload = resolve;
        script.onerror = () => {
          rendererPromise = undefined;
          script.remove();
          reject(new Error("GSの描画処理を読み込めませんでした。"));
        };
        document.head.appendChild(script);
      });
    }
    return rendererPromise;
  };

  const loadViewer = () => {
    if (!viewerPromise) {
      viewerPromise = loadRenderer().then(() => window.createPuiGs(canvas, {
        interactionElement: display,
        onDraw: () => {
          if (!canvas.hidden) {
            presentFrame(canvas);
          }
        },
        onInteractionEnd: (event) => {
          if (!canUseHover || !isSelected) {
            return;
          }
          const hoveredTile = event
            ? document.elementFromPoint(event.clientX, event.clientY)?.closest(".gallery > .tile")
            : null;
          if (hoveredTile === tile) {
            return;
          }
          if (hoveredTile) {
            selectOtherImage();
          } else {
            deactivatePui();
          }
        },
        onError: showViewerError
      })).then((renderer) => {
        viewer = renderer;
        renderer.setActive(false);
        return renderer;
      }).catch((error) => {
        viewerPromise = undefined;
        throw error;
      });
    }
    return viewerPromise;
  };

  const selectOtherImage = () => {
    isOtherImageSelected = true;
    shouldHoldOtherFrame = true;
    isSelected = false;
    isPlayingSelf = false;
    if (returnViewerToFront()) {
      return;
    }
    isFinishingSelf = false;
    playTo(otherHoverFrame);
  };

  const deselectOtherImage = () => {
    if (!isOtherImageSelected) {
      return;
    }

    isOtherImageSelected = false;
  };

  const activatePui = () => {
    const startFrame = !canvas.hidden && viewer ? viewer.getFrame() : currentFrame;
    cancelVideoHandoff?.();
    viewer?.cancelCameraReset();
    stopPlayback();
    isSelected = false;
    viewer?.setActive(false);
    canvas.hidden = true;
    media.classList.remove("isViewerActive");
    isReturningToFront = false;
    isFinishingSelf = false;
    isOtherImageSelected = false;
    shouldHoldOtherFrame = false;
    isSelected = true;
    isPlayingSelf = false;
    currentFrame = startFrame;
    window.galleryEffects.activate("pui");
    window.siteBackgroundEffects?.fadeOutEffect?.();

    const activation = ++viewerActivation;
    const wasReady = Boolean(viewer);
    if (!wasReady) {
      status.textContent = "Loading 4DGS...";
      status.hidden = false;
    }
    loadViewer().then(async (renderer) => {
      if (!isSelected || activation !== viewerActivation) {
        return;
      }
      viewer = renderer;
      const prepared = await renderer.prepareFrame(startFrame);
      if (!prepared || !isSelected || activation !== viewerActivation) {
        return;
      }
      requestAnimationFrame(() => {
        if (!isSelected || activation !== viewerActivation) {
          return;
        }
        currentFrame = startFrame;
        isPlayingSelf = true;
        status.hidden = true;
        canvas.hidden = false;
        media.classList.add("isViewerActive");
        presentFrame(canvas);
        playTo(47);
      });
    }).catch((error) => {
      if (activation === viewerActivation) {
        showViewerError(error);
      }
    });
  };

  const deactivatePui = () => {
    if (!isSelected) {
      return;
    }

    isSelected = false;
    isPlayingSelf = false;
    stopPlayback();
    if (!returnViewerToFront()) {
      finishWithVideo();
    }
    window.siteBackgroundEffects?.restoreGridFromTransparent?.();
  };

  document.addEventListener("gallery:effectactivate", (event) => {
    if (event.detail?.effect !== "pui") {
      selectOtherImage();
    }
  });

  const otherTiles = document.querySelectorAll(".gallery > .tile:not(.puiTile)");

  otherTiles.forEach((otherTile) => {
    if (canUseHover) {
      otherTile.addEventListener("mouseenter", selectOtherImage);
      otherTile.addEventListener("mouseleave", (event) => {
        if (!event.relatedTarget?.closest?.(".gallery > .tile")) {
          deselectOtherImage();
        }
      });
    } else {
      const otherImage = otherTile.querySelector(".image");
      otherImage?.addEventListener("pointerup", (event) => {
        if (event.pointerType === "touch") {
          selectOtherImage();
        }
      });
      otherImage?.addEventListener("click", selectOtherImage);
    }
  });

  if (canUseHover) {
    tile.addEventListener("mouseenter", activatePui);
    tile.addEventListener("mouseleave", (event) => {
      if (viewer?.isInteracting) {
        return;
      }
      if (event.relatedTarget?.closest?.(".gallery > .tile")) {
        selectOtherImage();
      } else {
        deactivatePui();
      }
    });
    return;
  }

  display.addEventListener("pointerup", (event) => {
    if (!canvas.hidden || event.pointerType !== "touch") {
      return;
    }

    lastTouchActivation = performance.now();
    activatePui();
  });

  display.addEventListener("click", () => {
    if (!canvas.hidden) {
      return;
    }
    if (performance.now() - lastTouchActivation < 700) {
      return;
    }

    activatePui();
  });

  document.addEventListener("click", (event) => {
    if (!event.target?.closest?.(".image, a")) {
      deactivatePui();
      deselectOtherImage();
    }
  });
})();
