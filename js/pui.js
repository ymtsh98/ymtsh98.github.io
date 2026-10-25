
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

  const configureVideo = (element) => {
    element.muted = true;
    element.defaultMuted = true;
    element.playsInline = true;
    element.setAttribute("muted", "");
    element.setAttribute("playsinline", "");
    element.setAttribute("webkit-playsinline", "");
  };

  configureVideo(video);

  const videoFps = 48;
  const otherHoverFrame = 22;
  const rendererUrl = new URL("pui-4dgs.js?v=20261025-13", document.currentScript.src).href;
  const canUseHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  let currentFrame = 0;
  let targetFrame = 0;
  let timer = 0;
  let videoAnimationFrame = 0;
  let playbackRevision = 0;
  let isVideoAnimating = false;
  let reversePreparation;
  let cancelPlaybackWait;
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

  const isVideoFrameReady = () => Boolean(reversePreparation?.frames.has(currentFrame))
    || (video.readyState >= 2 && !video.seeking);

  const presentVideoFrame = () => {
    if (canvas.hidden && isVideoFrameReady()) {
      presentFrame(reversePreparation?.frames.get(currentFrame) || video);
    }
  };

  const showFrame = () => {
    if (!reversePreparation?.frames.has(currentFrame) && (canvas.hidden || isReturningToFront)
      && video.readyState >= 1 && video.paused) {
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

  const waitForMedia = (element, events, isReady, signal) => new Promise((resolve, reject) => {
    const cleanup = () => {
      events.forEach((type) => element.removeEventListener(type, check));
      element.removeEventListener("error", fail);
      signal.removeEventListener("abort", abort);
    };
    const check = () => {
      if (isReady()) {
        cleanup();
        resolve();
      }
    };
    const fail = () => {
      cleanup();
      reject(new Error("動画を読み込めませんでした。"));
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("再生を中断しました。", "AbortError"));
    };
    events.forEach((type) => element.addEventListener(type, check));
    element.addEventListener("error", fail);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else check();
  });

  const releaseReverseFrames = (preparation) => {
    preparation.frames.forEach((image) => {
      image.width = 0;
      image.height = 0;
    });
    preparation.frames.clear();
  };

  const discardReversePreparation = () => {
    if (!reversePreparation) return;
    const preparation = reversePreparation;
    reversePreparation = undefined;
    preparation.controller.abort();
    preparation.decoder.pause();
    releaseReverseFrames(preparation);
  };

  const prepareReverseFrames = (firstFrame, lastFrame) => {
    if (reversePreparation?.firstFrame === firstFrame && reversePreparation.lastFrame === lastFrame) {
      return reversePreparation.promise;
    }
    discardReversePreparation();
    const decoder = document.createElement("video");
    configureVideo(decoder);
    decoder.className = "puiDecoder";
    decoder.setAttribute("aria-hidden", "true");
    decoder.preload = "auto";
    const preparation = {
      firstFrame,
      lastFrame,
      decoder,
      controller: new AbortController(),
      frames: new Map()
    };
    reversePreparation = preparation;
    const signal = preparation.controller.signal;
    preparation.promise = (async () => {
      try {
        media.appendChild(decoder);
        decoder.src = video.currentSrc || video.src;
        decoder.load();
        await decoder.play();
        decoder.pause();
        signal.throwIfAborted();
        await waitForMedia(decoder, ["loadedmetadata"], () => decoder.readyState >= 1, signal);
        const ratio = window.devicePixelRatio || 1;
        const scale = Math.min(1, media.clientWidth * ratio / decoder.videoWidth,
          media.clientHeight * ratio / decoder.videoHeight);
        const width = Math.max(1, Math.round(decoder.videoWidth * scale));
        const height = Math.max(1, Math.round(decoder.videoHeight * scale));
        const capture = (frame) => {
          if (preparation.frames.has(frame)) return;
          const image = document.createElement("canvas");
          image.width = width;
          image.height = height;
          image.getContext("2d").drawImage(decoder, 0, 0, width, height);
          preparation.frames.set(frame, image);
        };
        const seek = async (frame) => {
          signal.throwIfAborted();
          decoder.currentTime = (frame + 0.5) / videoFps;
          await waitForMedia(decoder, ["seeked", "loadeddata"],
            () => decoder.readyState >= 2 && !decoder.seeking, signal);
        };
        await seek(lastFrame);
        capture(lastFrame);
        if (decoder.requestVideoFrameCallback && firstFrame > lastFrame) {
          try {
            await new Promise((resolve, reject) => {
              let callback;
              const cleanup = () => {
                decoder.cancelVideoFrameCallback(callback);
                decoder.removeEventListener("ended", finish);
                decoder.removeEventListener("error", fail);
                signal.removeEventListener("abort", abort);
                decoder.pause();
              };
              const finish = () => { cleanup(); resolve(); };
              const fail = (error) => { cleanup(); reject(error); };
              const abort = () => fail(new DOMException("再生を中断しました。", "AbortError"));
              const collect = (_, metadata) => {
                const frame = Math.round(metadata.mediaTime * videoFps);
                if (frame >= lastFrame && frame <= firstFrame) capture(frame);
                if (frame >= firstFrame) finish();
                else callback = decoder.requestVideoFrameCallback(collect);
              };
              decoder.addEventListener("ended", finish);
              decoder.addEventListener("error", fail);
              signal.addEventListener("abort", abort, { once: true });
              callback = decoder.requestVideoFrameCallback(collect);
              decoder.play().catch(fail);
            });
          } catch (error) {
            if (signal.aborted) throw error;
          }
        }
        for (let frame = lastFrame; frame <= firstFrame; frame++) {
          if (!preparation.frames.has(frame)) {
            await seek(frame);
            capture(frame);
          }
        }
        return preparation;
      } finally {
        decoder.pause();
        decoder.removeAttribute("src");
        decoder.load();
        decoder.remove();
      }
    })();
    return preparation.promise;
  };

  video.addEventListener("loadeddata", showFrame);
  video.addEventListener("seeked", presentVideoFrame);
  showFrame();
  const initialPlaybackRevision = playbackRevision;
  video.play().then(() => {
    if (initialPlaybackRevision === playbackRevision && !isVideoAnimating && canvas.hidden) {
      video.pause();
      showFrame();
    }
  }).catch((error) => {
    if (error?.name !== "NotAllowedError" && error?.name !== "AbortError") console.error(error);
  });

  const stopPlayback = ({ preserveReverse = false } = {}) => {
    playbackRevision += 1;
    window.clearInterval(timer);
    cancelAnimationFrame(videoAnimationFrame);
    video.pause();
    cancelPlaybackWait?.();
    if (!preserveReverse) discardReversePreparation();
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

  const reportPlaybackError = (revision, error) => {
    if (revision !== playbackRevision || error?.name === "AbortError") return;
    stopPlayback();
    status.textContent = "動画を再生できませんでした。";
    status.hidden = false;
    console.error(error);
  };

  const finishVideoPlayback = (frame) => {
    stopPlayback();
    currentFrame = frame;
    targetFrame = frame;
    isFinishingSelf = false;
    isPlayingSelf = false;
    showFrame();
  };

  const playVideoForward = (revision) => {
    const wrapsToStart = isFinishingSelf || isPlayingSelf;
    const firstFrame = currentFrame;
    let positioned = false;
    const draw = () => {
      if (revision !== playbackRevision) return;
      if (video.ended) {
        finishVideoPlayback(wrapsToStart ? 0 : targetFrame);
        return;
      }
      if (positioned && video.readyState >= 2 && !video.seeking) {
        const frame = Math.min(47, Math.floor(video.currentTime * videoFps));
        if (!wrapsToStart && frame >= targetFrame) {
          finishVideoPlayback(targetFrame);
          return;
        }
        if (frame !== currentFrame) {
          currentFrame = frame;
          presentVideoFrame();
        }
      }
      videoAnimationFrame = requestAnimationFrame(draw);
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", position);
      cancelPlaybackWait = undefined;
    };
    const position = () => {
      if (revision !== playbackRevision) {
        cleanup();
      } else if (!positioned && video.readyState >= 1) {
        positioned = true;
        const time = (firstFrame + 0.5) / videoFps;
        if (Math.abs(video.currentTime - time) > 0.000001) {
          video.currentTime = time;
        }
        cleanup();
      }
    };
    cancelPlaybackWait = cleanup;
    video.addEventListener("loadedmetadata", position);
    video.playbackRate = 1;
    position();
    video.play().catch((error) => reportPlaybackError(revision, error));
    videoAnimationFrame = requestAnimationFrame(draw);
  };

  const playVideoReverse = (revision) => {
    const firstFrame = currentFrame;
    const lastFrame = targetFrame;
    prepareReverseFrames(firstFrame, lastFrame).then((preparation) => {
      if (revision !== playbackRevision) return;
      const start = performance.now();
      const distance = firstFrame - lastFrame;
      const draw = (now) => {
        if (revision !== playbackRevision) return;
        const steps = Math.min(distance, Math.floor((now - start) * videoFps / 1000));
        const frame = firstFrame - steps;
        if (frame !== currentFrame) {
          currentFrame = frame;
          presentFrame(preparation.frames.get(frame));
          preparation.frames.forEach((image, index) => {
            if (index > frame) {
              image.width = 0;
              image.height = 0;
              preparation.frames.delete(index);
            }
          });
        }
        if (steps === distance) {
          finishVideoPlayback(lastFrame);
          return;
        }
        videoAnimationFrame = requestAnimationFrame(draw);
      };
      presentVideoFrame();
      videoAnimationFrame = requestAnimationFrame(draw);
    }).catch((error) => reportPlaybackError(revision, error));
  };

  const playTo = (frame) => {
    if (isVideoAnimating && targetFrame === frame && !isPlayingSelf) {
      return;
    }
    const backwards = !isPlayingSelf && (isFinishingSelf ? finishDirection < 0 : frame < currentFrame);
    stopPlayback({ preserveReverse: backwards });
    targetFrame = frame;
    if (isPlayingSelf || currentFrame !== targetFrame) {
      if (isPlayingSelf && viewer) {
        timer = window.setInterval(advanceFrame, 1000 / viewer.fps);
      } else {
        isVideoAnimating = true;
        if (backwards) playVideoReverse(playbackRevision);
        else playVideoForward(playbackRevision);
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

  const prepareVideoReturn = () => {
    const lastFrame = shouldHoldOtherFrame ? otherHoverFrame : 0;
    const backwards = shouldHoldOtherFrame ? currentFrame > lastFrame
      : currentFrame > 0 && currentFrame <= 48 - currentFrame;
    if (backwards) {
      prepareReverseFrames(currentFrame, lastFrame).catch((error) => {
        if (error?.name !== "AbortError") console.error(error);
      });
    } else {
      discardReversePreparation();
    }
  };

  const returnViewerToFront = () => {
    if (isReturningToFront) {
      prepareVideoReturn();
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
    prepareVideoReturn();
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
