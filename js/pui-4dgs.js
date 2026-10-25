(() => {
  const sceneUrl = new URL("../images/2026/pui-4dgs-data.js?v=20261025-4", document.currentScript.src).href;
  let scenePromise;

  const loadScene = () => {
    if (!scenePromise) {
      scenePromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = sceneUrl;
        script.onload = () => resolve(window.pui4dgsData);
        script.onerror = () => {
          scenePromise = undefined;
          script.remove();
          reject(new Error("4DGSデータを読み込めませんでした。"));
        };
        document.head.appendChild(script);
      });
    }

    return scenePromise;
  };

  window.createPuiGs = async (canvas, {
    interactionElement = canvas,
    onDraw,
    onInteractionEnd,
    onError
  } = {}) => {
    const scene = await loadScene();
    const { config } = scene;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true
    });

    if (!gl) {
      throw new Error("WebGL 2を初期化できませんでした。");
    }

    const initialTarget = [...config.target];
    const target = [...initialTarget];
    const initialOffset = config.cameraPosition.map((value, index) => value - target[index]);
    const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
    const normalize = (vector) => {
      const length = Math.hypot(...vector);
      return vector.map((value) => value / length);
    };
    const cache = new Map();
    const depthBounds = new Map();
    const pointers = new Map();
    let suppressDragContextMenu = false;
    const initialRadius = Math.hypot(...initialOffset);
    const initialYaw = Math.atan2(dot(initialOffset, config.basisRight), -dot(initialOffset, config.basisForward));
    const initialPitch = Math.asin(dot(initialOffset, config.basisUp) / initialRadius);
    let radius = initialRadius;
    let yaw = initialYaw;
    let pitch = initialPitch;
    let cameraReset;
    let active = true;
    let failed = false;
    let dirty = true;
    let animationFrame;
    let worker;
    let sortBusy = false;
    let viewRevision = 0;
    let sortedRevision = -1;
    let requestedFrame = 0;
    let activeFrame = -1;
    let renderedFrame = -1;
    let framePreparation;
    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    ready.catch(() => {});

    const cancelCameraReset = () => {
      const reset = cameraReset;
      cameraReset = undefined;
      reset?.resolve(false);
    };

    const cancelFramePreparation = () => {
      const preparation = framePreparation;
      framePreparation = undefined;
      preparation?.resolve(false);
    };

    const fail = (error) => {
      failed = true;
      active = false;
      cancelCameraReset();
      cancelFramePreparation();
      cancelAnimationFrame(animationFrame);
      worker?.terminate();
      rejectReady(error);
      onError?.(error);
    };

    const compileShader = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
      }
      return shader;
    };

    const program = gl.createProgram();
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER, scene.vertexShader));
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, scene.fragmentShader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);
    const cropPlane = gl.getUniformLocation(program, "cropPlane");
    if (cropPlane !== null) {
      gl.uniform4fv(cropPlane, config.cropPlane);
    }
    const uniforms = Object.fromEntries(
      ["splatData", "textureWidth", "viewRotation", "cameraPosition", "focal", "viewport"]
        .map((name) => [name, gl.getUniformLocation(program, name)])
    );
    const textureWidth = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const textureHeight = Math.ceil(config.maxCount * 3 / textureWidth);
    const textureValues = new Float32Array(textureWidth * textureHeight * 4);
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    for (const setting of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) {
      gl.texParameteri(gl.TEXTURE_2D, setting, gl.NEAREST);
    }
    for (const setting of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) {
      gl.texParameteri(gl.TEXTURE_2D, setting, gl.CLAMP_TO_EDGE);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, textureWidth, textureHeight, 0, gl.RGBA, gl.FLOAT, null);
    gl.uniform1i(uniforms.splatData, 0);
    gl.uniform1i(uniforms.textureWidth, textureWidth);
    gl.bindVertexArray(gl.createVertexArray());
    const cornerBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const cornerLocation = gl.getAttribLocation(program, "corner");
    gl.enableVertexAttribArray(cornerLocation);
    gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 0, 0);
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, config.maxCount * 4, gl.DYNAMIC_DRAW);
    const indexLocation = gl.getAttribLocation(program, "splatIndex");
    gl.enableVertexAttribArray(indexLocation);
    gl.vertexAttribIPointer(indexLocation, 1, gl.UNSIGNED_INT, 0, 0);
    gl.vertexAttribDivisor(indexLocation, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const cameraState = (frame = config.frames[Math.max(activeFrame, 0)]) => {
      const offset = config.basisRight.map((value, index) => (
        Math.cos(pitch) * Math.sin(yaw) * value
        - Math.cos(pitch) * Math.cos(yaw) * config.basisForward[index]
        + Math.sin(pitch) * config.basisUp[index]
      ));
      const position = target.map((value, index) => value + radius * offset[index]);
      const forward = normalize(offset.map((value) => -value));
      const right = normalize(config.basisRight.map((value, index) => (
        Math.cos(yaw) * value + Math.sin(yaw) * config.basisForward[index]
      )));
      const down = cross(forward, right);
      const rotate = (vector) => frame.rotation.map((row) => dot(row, vector));
      const nativePosition = rotate(position).map((value, index) => (
        value * frame.scale + frame.translation[index]
      ));
      const nativeForward = rotate(forward);
      const nativeRight = rotate(right);
      const nativeDown = rotate(down);
      return {
        position: nativePosition,
        forward: nativeForward,
        right,
        down,
        rotation: new Float32Array([
          nativeRight[0], nativeDown[0], nativeForward[0],
          nativeRight[1], nativeDown[1], nativeForward[1],
          nativeRight[2], nativeDown[2], nativeForward[2]
        ])
      };
    };

    const uploadFrame = (index, order) => {
      const frame = config.frames[index];
      const height = Math.ceil(frame.count * 3 / textureWidth);
      textureValues.set(cache.get(frame.url).values);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, textureWidth, height, gl.RGBA, gl.FLOAT,
        textureValues.subarray(0, textureWidth * height * 4));
      gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, order);
      activeFrame = index;
      dirty = true;
    };

    const drawFrame = (now) => {
      animationFrame = undefined;
      if (!active || failed) {
        return;
      }

      try {
        if (cameraReset && !cameraReset.complete) {
          const progress = Math.min((now - cameraReset.start) / cameraReset.duration, 1);
          const weight = 1 - (1 - progress) ** 3;
          radius = cameraReset.radius + (initialRadius - cameraReset.radius) * weight;
          yaw = cameraReset.yaw + cameraReset.yawDelta * weight;
          pitch = cameraReset.pitch + cameraReset.pitchDelta * weight;
          for (let axis = 0; axis < 3; axis++) {
            target[axis] = cameraReset.target[axis]
              + (initialTarget[axis] - cameraReset.target[axis]) * weight;
          }
          if (progress === 1) {
            radius = initialRadius;
            yaw = initialYaw;
            pitch = initialPitch;
            target.splice(0, target.length, ...initialTarget);
            cameraReset.complete = true;
          }
          invalidateView();
        }

        const host = canvas.parentElement;
        const width = Math.max(1, Math.round(host.clientWidth * (window.devicePixelRatio || 1)));
        const height = Math.max(1, Math.round(host.clientHeight * (window.devicePixelRatio || 1)));
        if (width !== canvas.width || height !== canvas.height) {
          canvas.width = width;
          canvas.height = height;
          gl.viewport(0, 0, width, height);
          dirty = true;
        }

        const frame = config.frames[requestedFrame];
        const payload = cache.get(frame.url);
        if (!sortBusy && payload && (requestedFrame !== activeFrame || sortedRevision !== viewRevision)) {
          const camera = cameraState(frame);
          worker.postMessage({
            positions: payload.positions,
            depthBoundsPositions: depthBounds.get(frame.url),
            planes: [...camera.forward, -dot(camera.forward, camera.position)],
            frame: requestedFrame,
            revision: viewRevision
          });
          sortBusy = true;
        }

        if (dirty && activeFrame >= 0 && (!cameraReset || activeFrame === requestedFrame)
          && (!framePreparation || activeFrame === framePreparation.index)) {
          const displayed = config.frames[activeFrame];
          const camera = cameraState(displayed);
          const focalY = canvas.height / (2 * Math.tan(displayed.fov / 2));
          gl.uniformMatrix3fv(uniforms.viewRotation, false, camera.rotation);
          gl.uniform3fv(uniforms.cameraPosition, camera.position);
          gl.uniform2f(uniforms.focal, focalY * displayed.focalRatio, focalY);
          gl.uniform2f(uniforms.viewport, canvas.width, canvas.height);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, displayed.count);
          dirty = false;
          const error = gl.getError();
          if (error !== gl.NO_ERROR) {
            throw new Error(`4DGS描画エラー: ${error}`);
          }
          renderedFrame = activeFrame;
          onDraw?.(canvas, renderedFrame);
          resolveReady(controller);
          if (framePreparation && activeFrame === framePreparation.index && sortedRevision === viewRevision) {
            const preparation = framePreparation;
            framePreparation = undefined;
            preparation.resolve(true);
          }
          if (cameraReset?.complete && sortedRevision === viewRevision) {
            const reset = cameraReset;
            cameraReset = undefined;
            reset.resolve(true);
          }
        }

        animationFrame = requestAnimationFrame(drawFrame);
      } catch (error) {
        fail(error);
      }
    };

    const invalidateView = () => {
      viewRevision += 1;
      dirty = true;
    };

    const controller = {
      fps: config.fps,
      get isInteracting() {
        return pointers.size > 0;
      },
      setFrame(index) {
        if (framePreparation && framePreparation.index !== index) {
          cancelFramePreparation();
        }
        requestedFrame = index;
      },
      prepareFrame(index) {
        cancelFramePreparation();
        if (failed) {
          return Promise.resolve(false);
        }
        requestedFrame = index;
        dirty = true;
        return new Promise((resolve) => {
          framePreparation = { index, resolve };
          controller.setActive(true);
        });
      },
      getFrame() {
        return Math.max(renderedFrame, 0);
      },
      cancelCameraReset,
      resetCamera(duration = 460) {
        cancelCameraReset();
        if (failed) {
          return Promise.resolve(false);
        }
        if (radius === initialRadius && yaw === initialYaw && pitch === initialPitch
          && target.every((value, index) => value === initialTarget[index])) {
          return Promise.resolve(true);
        }
        return new Promise((resolve) => {
          cameraReset = {
            start: performance.now(),
            duration,
            radius,
            yaw,
            pitch,
            target: [...target],
            yawDelta: Math.atan2(Math.sin(initialYaw - yaw), Math.cos(initialYaw - yaw)),
            pitchDelta: Math.atan2(Math.sin(initialPitch - pitch), Math.cos(initialPitch - pitch)),
            complete: false,
            resolve
          };
          controller.setActive(true);
        });
      },
      setActive(value) {
        active = value;
        if (!active) {
          cancelCameraReset();
          cancelFramePreparation();
          cancelAnimationFrame(animationFrame);
          animationFrame = undefined;
          for (const pointerId of pointers.keys()) {
            if (interactionElement.hasPointerCapture(pointerId)) {
              interactionElement.releasePointerCapture(pointerId);
            }
          }
          pointers.clear();
        } else if (!failed && animationFrame === undefined) {
          dirty = true;
          animationFrame = requestAnimationFrame(drawFrame);
        }
      }
    };

    const decodeHalf = (value) => {
      const sign = value & 32768 ? -1 : 1;
      const exponent = value >> 10 & 31;
      const mantissa = value & 1023;
      if (exponent === 0) return sign * mantissa * 2 ** -24;
      if (exponent === 31) return mantissa ? NaN : sign * Infinity;
      return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
    };

    const readUnsigned = (bytes, offset, size) => {
      let value = 0;
      for (let index = 0; index < size; index++) {
        value += bytes[offset + index] * 2 ** (8 * index);
      }
      return value;
    };

    const readShuffledSigned = (bytes, offset, index, count, size) => {
      let value = 0;
      for (let byte = 0; byte < size; byte++) {
        value += bytes[offset + index + byte * count] * 2 ** (8 * byte);
      }
      const sign = 2 ** (8 * size - 1);
      return value >= sign ? value - 2 ** (8 * size) : value;
    };

    const decodeChannel = (bytes, descriptor, count, frameCount, assign) => {
      if (descriptor.kind === "delta") {
        const length = count * frameCount;
        for (let point = 0; point < count; point++) {
          let value = 0;
          for (let frame = 0; frame < frameCount; frame++) {
            value += readShuffledSigned(bytes, 0, point * frameCount + frame, length, descriptor.wordBytes);
            assign(frame, point, value * descriptor.step);
          }
        }
        return;
      }
      if (descriptor.kind !== "tracks") {
        throw new Error("4DGSの圧縮方式を読み込めません。");
      }
      const timesOffset = count * descriptor.countBytes;
      const valuesOffset = timesOffset + descriptor.knots * descriptor.timeBytes;
      let cursor = 0;
      for (let point = 0; point < count; point++) {
        const knots = readUnsigned(bytes, point * descriptor.countBytes, descriptor.countBytes);
        let previousTime = 0;
        let previousValue = 0;
        for (let knot = 0; knot < knots; knot++, cursor++) {
          const time = readUnsigned(bytes, timesOffset + cursor * descriptor.timeBytes, descriptor.timeBytes);
          const value = previousValue + readShuffledSigned(bytes, valuesOffset, cursor, descriptor.knots, descriptor.wordBytes);
          if (knot === 0) {
            assign(0, point, value * descriptor.step);
          } else {
            for (let frame = previousTime + 1; frame <= time; frame++) {
              const weight = (frame - previousTime) / (time - previousTime);
              assign(frame, point, (previousValue + weight * (value - previousValue)) * descriptor.step);
            }
          }
          previousTime = time;
          previousValue = value;
        }
        for (let frame = previousTime + 1; frame < frameCount; frame++) {
          assign(frame, point, previousValue * descriptor.step);
        }
      }
      if (cursor !== descriptor.knots) {
        throw new Error("4DGSの動きデータの長さが一致しません。");
      }
    };

    const loadFrames = async () => {
      const bytes = typeof Uint8Array.fromBase64 === "function"
        ? Uint8Array.fromBase64(scene.payload)
        : Uint8Array.from(atob(scene.payload), (character) => character.charCodeAt(0));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      const raw = new Uint8Array(await new Response(stream).arrayBuffer());
      const decoder = new TextDecoder();
      if (decoder.decode(raw.subarray(0, 8)) !== "MGSC0001") {
        throw new Error("4DGSデータの形式が違います。");
      }
      const headerLength = new DataView(raw.buffer, raw.byteOffset + 8, 4).getUint32(0, true);
      const header = JSON.parse(decoder.decode(raw.subarray(12, 12 + headerLength)));
      if (header.version !== 2 || header.count !== config.count || header.frameCount !== config.frames.length) {
        throw new Error("4DGSデータの設定が一致しません。");
      }

      const values = Array.from({ length: header.frameCount }, () => new Float32Array(header.count * 12));
      const columns = [0, 1, 2, 4, 5, 6, 8, 9, 10, 11, 7];
      let offset = 12 + headerLength;
      for (let channel = 0; channel < header.channels.length; channel++) {
        const descriptor = header.channels[channel];
        const block = raw.subarray(offset, offset + descriptor.bytes);
        const column = columns[channel];
        const assign = (frame, point, value) => {
          values[frame][point * 12 + column] = channel >= 3 && channel < 6 ? Math.exp(value) : value;
        };
        if (descriptor.groups) {
          let groupOffset = 0;
          for (const group of descriptor.groups) {
            decodeChannel(block.subarray(groupOffset, groupOffset + group.bytes), group, group.count,
              header.frameCount, (frame, point, value) => assign(frame, point + group.offset, value));
            groupOffset += group.bytes;
          }
          if (groupOffset !== descriptor.bytes) {
            throw new Error("4DGSのグループ長が一致しません。");
          }
        } else {
          decodeChannel(block, descriptor, header.count, header.frameCount, assign);
        }
        offset += descriptor.bytes;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }

      const appearance = new Float32Array(header.count * 48);
      for (let coefficient = 0; coefficient < 3; coefficient++) {
        for (let point = 0; point < header.count; point++) {
          const index = offset + coefficient * header.count * 2 + point;
          appearance[point * 48 + coefficient] = decodeHalf(raw[index] + raw[index + header.count] * 256);
        }
      }
      const acCount = ((header.sh.coefficients || 4) - 1) * 3;
      for (let coefficient = 0; coefficient < acCount; coefficient++) {
        for (let point = 0; point < header.count; point++) {
          appearance[point * 48 + coefficient + 3] = header.sh.minimum[coefficient]
            + raw[offset + header.count * 6 + coefficient * header.count + point] * header.sh.step[coefficient];
        }
      }
      offset += header.sh.bytes;
      for (let frame = 0; frame < header.frameCount; frame++) {
        const descriptor = header.bounds[frame];
        const bounds = raw.slice(offset, offset + descriptor.bytes);
        depthBounds.set(config.frames[frame].url, new Float32Array(bounds.buffer));
        offset += descriptor.bytes;
      }
      if (offset !== raw.length) {
        throw new Error("4DGSデータの長さが一致しません。");
      }

      const shHeight = Math.ceil(config.count * 12 / textureWidth);
      const padded = new Float32Array(textureWidth * shHeight * 4);
      padded.set(appearance);
      const shTexture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, shTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, textureWidth, shHeight, 0, gl.RGBA, gl.FLOAT, padded);
      gl.uniform1i(gl.getUniformLocation(program, "sharedShData"), 1);
      gl.activeTexture(gl.TEXTURE0);

      for (let frame = 0; frame < header.frameCount; frame++) {
        const rows = values[frame];
        const positions = new Float32Array(header.count * 3);
        for (let point = 0; point < header.count; point++) {
          const start = point * 12;
          const norm = Math.hypot(rows[start + 8], rows[start + 9], rows[start + 10], rows[start + 11]);
          if (norm > 0) {
            for (let axis = 8; axis < 12; axis++) rows[start + axis] /= norm;
          }
          positions.set(rows.subarray(start, start + 3), point * 3);
        }
        cache.set(config.frames[frame].url, { values: rows, positions });
      }
    };

    const trackCamera = (deltaX, deltaY) => {
      const camera = cameraState();
      const scale = 2 * radius * Math.tan(config.fov / 2) / Math.max(interactionElement.clientHeight, 1);
      for (let axis = 0; axis < 3; axis++) {
        target[axis] -= scale * (camera.right[axis] * deltaX / config.focalRatio + camera.down[axis] * deltaY);
      }
    };

    document.addEventListener("pointerdown", () => {
      suppressDragContextMenu = false;
    }, true);
    document.addEventListener("contextmenu", (event) => {
      if (suppressDragContextMenu) {
        suppressDragContextMenu = false;
        event.preventDefault();
      }
    }, true);
    interactionElement.addEventListener("contextmenu", (event) => {
      if (active && !canvas.hidden) event.preventDefault();
    });
    interactionElement.addEventListener("pointerdown", (event) => {
      if (!active || canvas.hidden || (event.pointerType === "mouse" && event.button !== 0 && event.button !== 2)) {
        return;
      }
      event.preventDefault();
      if (event.pointerType === "mouse" && event.button === 2) {
        suppressDragContextMenu = true;
      }
      cancelCameraReset();
      interactionElement.focus({ preventScroll: true });
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      interactionElement.setPointerCapture(event.pointerId);
    });

    interactionElement.addEventListener("pointermove", (event) => {
      const previous = pointers.get(event.pointerId);
      if (!active || canvas.hidden || !previous) {
        return;
      }
      event.preventDefault();
      const deltaX = event.clientX - previous.x;
      const deltaY = event.clientY - previous.y;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (event.pointerType === "mouse" && (event.buttons & 2)) {
        trackCamera(deltaX, deltaY);
      } else if (pointers.size === 2) {
        const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)[1];
        const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
        const newDistance = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        trackCamera(deltaX / 2, deltaY / 2);
        if (oldDistance > 0 && newDistance > 0) radius *= oldDistance / newDistance;
      } else {
        yaw -= deltaX * 0.005;
        pitch += deltaY * 0.005;
      }
      invalidateView();
    });

    const endInteraction = (event) => {
      if (event.type === "pointercancel") {
        suppressDragContextMenu = false;
      }
      if (pointers.delete(event.pointerId) && pointers.size === 0) {
        onInteractionEnd?.(event);
      }
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      interactionElement.addEventListener(type, endInteraction);
    }
    window.addEventListener("blur", () => {
      suppressDragContextMenu = false;
      const wasInteracting = pointers.size > 0;
      pointers.clear();
      if (wasInteracting) onInteractionEnd?.();
    });
    interactionElement.addEventListener("wheel", (event) => {
      if (!active || canvas.hidden) return;
      event.preventDefault();
      cancelCameraReset();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? interactionElement.clientHeight : 1;
      const distance = radius * Math.exp(event.deltaY * scale * 0.001);
      if (distance > 0 && Number.isFinite(distance)) radius = distance;
      invalidateView();
    }, { passive: false });
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      fail(new Error("4DGSの描画コンテキストが失われました。"));
    });

    const workerUrl = URL.createObjectURL(new Blob([scene.sortWorker], { type: "text/javascript" }));
    worker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);
    worker.onerror = (event) => fail(new Error(event.message));
    worker.onmessage = ({ data }) => {
      sortBusy = false;
      if (failed || data.revision !== viewRevision
        || ((cameraReset || framePreparation) && data.frame !== requestedFrame)) return;
      uploadFrame(data.frame, data.order);
      sortedRevision = data.revision;
    };

    try {
      await loadFrames();
      animationFrame = requestAnimationFrame(drawFrame);
      return await ready;
    } catch (error) {
      worker.terminate();
      cancelAnimationFrame(animationFrame);
      throw error;
    }
  };
})();
