(() => {
  const sceneUrl = new URL("../images/2026/pui-4dgs-data.js?v=20261025-4", document.currentScript.src).href;

  const dataError = () => new Error("4DGSデータを読み込めませんでした。");

  const loadLocalScene = () => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = sceneUrl;
    script.onload = () => {
      script.remove();
      const data = window.pui4dgsData;
      delete window.pui4dgsData;
      if (!data?.payload) {
        reject(dataError());
        return;
      }
      const { payload, ...scene } = data;
      resolve({ scene, payload: new Blob([payload, '"']) });
    };
    script.onerror = () => {
      script.remove();
      reject(dataError());
    };
    document.head.appendChild(script);
  });

  const runWorker = () => {
    let config;
    let textureWidth;
    let previewScale;
    let values;
    let loadedSplatCount = 0;
    let geometryRevision = 0;
    let shapeReady = false;
    let frameDataComplete = false;
    const depthBounds = [];

    const dataError = () => new Error("4DGSデータを読み込めませんでした。");

    const decodePayload = (reader, initialText = "") => {
      let text = initialText;
      return new ReadableStream({
        async pull(controller) {
          while (true) {
            const end = text.indexOf('"');
            const length = end < 0 ? text.length - text.length % 4 : end;
            if (length) {
              const base64 = text.slice(0, length);
              const bytes = typeof Uint8Array.fromBase64 === "function"
                ? Uint8Array.fromBase64(base64, { lastChunkHandling: "strict" })
                : Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
              controller.enqueue(bytes);
            }
            if (end >= 0) {
              if (length % 4 !== 0) throw dataError();
              controller.close();
              return reader.cancel();
            }
            text = text.slice(length);
            if (length) return;
            const { done, value } = await reader.read();
            if (done) throw dataError();
            text += value;
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        }
      }).pipeThrough(new DecompressionStream("gzip"));
    };

    const loadScene = async ({ url, local }) => {
      if (local) {
        const reader = local.payload.stream().pipeThrough(new TextDecoderStream()).getReader();
        return { scene: local.scene, stream: decodePayload(reader) };
      }
      const response = await fetch(url);
      if (!response.ok || !response.body) throw dataError();
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      const assignment = "window.pui4dgsData = ";
      const marker = ',"payload":"';
      let text = "";
      let end = -1;
      while (end < 0) {
        const { done, value } = await reader.read();
        if (done) throw dataError();
        text += value;
        end = text.indexOf(marker);
      }

      if (!text.startsWith(assignment)) throw dataError();
      const scene = JSON.parse(text.slice(assignment.length, end) + "}");
      return { scene, stream: decodePayload(reader, text.slice(end + marker.length)) };
    };

    const getFrameHeight = (count) => Math.ceil(count * 3 / textureWidth);

    const snapshotFrame = (rows, count) => {
      const snapshot = rows.slice(0, textureWidth * getFrameHeight(count) * 4);
      if (frameDataComplete) return snapshot;
      for (let point = 0; point < count; point++) {
        const offset = point * 12;
        if (!shapeReady) {
          snapshot.fill(previewScale, offset + 4, offset + 7);
          snapshot.fill(0, offset + 8, offset + 11);
          snapshot[offset + 11] = 1;
        }
        snapshot[offset + 7] = 0.35;
      }
      return snapshot;
    };

    const counts = new Uint32Array(65536);
    const offsets = new Uint32Array(65536);
    let depths = new Float32Array(0);
    let bins = new Uint16Array(0);

    const sortFrame = ({ frame, revision, planes, activeFrame, activeGeometryRevision }) => {
      const rows = values[frame];
      const count = Math.min(config.frames[frame].count, loadedSplatCount);
      const depthBoundsPositions = depthBounds[frame];
      if (depths.length !== count) {
        depths = new Float32Array(count);
        bins = new Uint16Array(count);
      }
      let minimum = Infinity;
      let maximum = -Infinity;
      for (let point = 0; point < count; point++) {
        const offset = point * 12;
        const depth = planes[0] * rows[offset] + planes[1] * rows[offset + 1]
          + planes[2] * rows[offset + 2] + planes[3];
        depths[point] = depth;
        minimum = Math.min(minimum, depth);
        maximum = Math.max(maximum, depth);
      }
      if (depthBoundsPositions?.length) {
        minimum = Infinity;
        maximum = -Infinity;
        for (let offset = 0; offset < depthBoundsPositions.length; offset += 3) {
          const depth = planes[0] * depthBoundsPositions[offset]
            + planes[1] * depthBoundsPositions[offset + 1]
            + planes[2] * depthBoundsPositions[offset + 2] + planes[3];
          minimum = Math.min(minimum, depth);
          maximum = Math.max(maximum, depth);
        }
      }
      counts.fill(0);
      const multiplier = 65535 / Math.max(maximum - minimum, 1e-8);
      for (let point = 0; point < count; point++) {
        const bin = Math.max(0, Math.min(65535, Math.floor((depths[point] - minimum) * multiplier)));
        bins[point] = bin;
        counts[bin] += 1;
      }
      let total = 0;
      for (let bin = 65535; bin >= 0; bin--) {
        offsets[bin] = total;
        total += counts[bin];
      }
      const order = new Uint32Array(count);
      for (let point = 0; point < count; point++) {
        order[offsets[bins[point]]++] = point;
      }
      const geometryChanged = frame !== activeFrame || geometryRevision !== activeGeometryRevision;
      const snapshot = geometryChanged ? snapshotFrame(rows, count) : null;
      const transfers = snapshot ? [order.buffer, snapshot.buffer] : [order.buffer];
      self.postMessage({ type: "sorted", frame, revision, geometryRevision, order, values: snapshot }, transfers);
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

    const decodeChannel = (bytes, descriptor, frameCount, assign) => {
      const { count } = descriptor;
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
      const knots = decodeTrackRange(bytes, descriptor, frameCount, assign, 0, count, 0);
      if (knots !== descriptor.knots) {
        throw new Error("4DGSの動きデータの長さが一致しません。");
      }
    };

    const decodeTrackRange = (bytes, descriptor, frameCount, assign, firstPoint, endPoint, cursor) => {
      const timesOffset = descriptor.count * descriptor.countBytes;
      const valuesOffset = timesOffset + descriptor.knots * descriptor.timeBytes;
      for (let point = firstPoint; point < endPoint; point++) {
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
      return cursor;
    };

    const decodePositionTracks = async (readBytes, readChunk, descriptor, frameCount, assign) => {
      const { count, countBytes, knots, timeBytes, wordBytes, bytes, offset } = descriptor;
      const highBytesOffset = count * countBytes + knots * (timeBytes + wordBytes - 1);
      if (highBytesOffset + knots !== bytes) {
        throw new Error("4DGSの動きデータの長さが一致しません。");
      }
      const block = new Uint8Array(bytes);
      block.set(await readBytes(highBytesOffset));

      let cursor = 0;
      let firstPoint = 0;
      let receivedKnots = 0;
      do {
        if (receivedKnots < knots) {
          const chunk = await readChunk(knots - receivedKnots);
          block.set(chunk, highBytesOffset + receivedKnots);
          receivedKnots += chunk.length;
        }

        let endPoint = firstPoint;
        let endKnot = cursor;
        while (endPoint < count) {
          const nextKnot = endKnot + readUnsigned(block, endPoint * countBytes, countBytes);
          if (nextKnot > knots) throw new Error("4DGSの動きデータの長さが一致しません。");
          if (nextKnot > receivedKnots) break;
          endKnot = nextKnot;
          endPoint++;
        }
        if (endPoint > firstPoint) {
          cursor = decodeTrackRange(block, descriptor, frameCount, assign, firstPoint, endPoint, cursor);
          firstPoint = endPoint;
          publishGeometry(offset + endPoint);
          await yieldToWorker();
        }
      } while (receivedKnots < knots);
      if (firstPoint !== count || cursor !== knots) {
        throw new Error("4DGSの動きデータの長さが一致しません。");
      }
    };

    const yieldToWorker = () => new Promise((resolve) => setTimeout(resolve, 0));

    const loadAppearance = async (count, sh, readBytes, readChunk) => {
      const acCount = ((sh.coefficients || 4) - 1) * 3;
      if (sh.bytes !== (6 + acCount) * count) {
        throw new Error("4DGSの外観データの長さが一致しません。");
      }

      const height = Math.ceil(count * 12 / textureWidth);
      const appearance = new Float32Array(textureWidth * height * 4);

      const publishAppearance = (firstPoint, endPoint) => {
        const firstRow = Math.floor(firstPoint * 12 / textureWidth);
        const endRow = Math.ceil(endPoint * 12 / textureWidth);
        const values = appearance.slice(firstRow * textureWidth * 4, endRow * textureWidth * 4);
        self.postMessage({ type: "appearance", firstRow, height: endRow - firstRow, values }, [values.buffer]);
      };

      const red = await readBytes(count * 2);
      const green = await readBytes(count * 2);
      const blueLow = await readBytes(count);
      let firstPoint = 0;
      while (firstPoint < count) {
        const blueHigh = await readChunk(count - firstPoint);
        const endPoint = firstPoint + blueHigh.length;
        for (let point = firstPoint; point < endPoint; point++) {
          const offset = point * 48;
          appearance[offset] = decodeHalf(red[point] + red[point + count] * 256);
          appearance[offset + 1] = decodeHalf(green[point] + green[point + count] * 256);
          appearance[offset + 2] = decodeHalf(blueLow[point] + blueHigh[point - firstPoint] * 256);
        }
        publishAppearance(firstPoint, endPoint);
        firstPoint = endPoint;
        await yieldToWorker();
      }

      let coefficient = 0;
      for (let degree = 1; coefficient < acCount; degree++) {
        const end = Math.min(acCount, ((degree + 1) ** 2 - 1) * 3);
        for (; coefficient < end; coefficient++) {
          const channel = await readBytes(count);
          for (let point = 0; point < count; point++) {
            appearance[point * 48 + coefficient + 3] = sh.minimum[coefficient]
              + channel[point] * sh.step[coefficient];
          }
        }
        publishAppearance(0, count);
        await yieldToWorker();
      }
    };

    const loadFrames = async (stream) => {
      const reader = stream.getReader();
      let buffer = new Uint8Array(0);
      const readChunk = async (maximumLength) => {
        while (!buffer.length) {
          const { done, value } = await reader.read();
          if (done) throw dataError();
          buffer = value;
        }
        const length = Math.min(buffer.length, maximumLength);
        const chunk = buffer.subarray(0, length);
        buffer = buffer.subarray(length);
        return chunk;
      };
      const readBytes = async (length) => {
        const bytes = new Uint8Array(length);
        let offset = 0;
        while (offset < length) {
          const chunk = await readChunk(length - offset);
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        return bytes;
      };

      try {
        await decodeFrames(readBytes, readChunk);
        if (buffer.length || !(await reader.read()).done) {
          throw new Error("4DGSデータの長さが一致しません。");
        }
        self.postMessage({ type: "complete" });
      } finally {
        await reader.cancel();
      }
    };

    const decodeFrames = async (readBytes, readChunk) => {
      const prefix = await readBytes(12);
      const decoder = new TextDecoder();
      if (decoder.decode(prefix.subarray(0, 8)) !== "MGSC0001") {
        throw new Error("4DGSデータの形式が違います。");
      }
      const headerLength = new DataView(prefix.buffer).getUint32(8, true);
      const header = JSON.parse(decoder.decode(await readBytes(headerLength)));
      if (header.version !== 2 || header.count !== config.count || header.frameCount !== config.frames.length) {
        throw new Error("4DGSデータの設定が一致しません。");
      }

      const valueCount = textureWidth * getFrameHeight(header.count) * 4;
      values = Array.from({ length: header.frameCount }, () => new Float32Array(valueCount));
      const columns = [0, 1, 2, 4, 5, 6, 8, 9, 10, 11, 7];
      for (let channel = 0; channel < header.channels.length; channel++) {
        const descriptor = header.channels[channel];
        const column = columns[channel];
        const groups = descriptor.groups ?? [{ ...descriptor, count: header.count, offset: 0 }];
        let groupBytes = 0;
        for (const group of groups) {
          const assign = (frame, point, value) => {
            values[frame][(point + group.offset) * 12 + column] = channel >= 3 && channel < 6 ? Math.exp(value) : value;
          };
          if (column === 2 && group.kind === "tracks") {
            await decodePositionTracks(readBytes, readChunk, group, header.frameCount, assign);
          } else {
            const block = await readBytes(group.bytes);
            decodeChannel(block, group, header.frameCount, assign);
            if (column === 2) publishGeometry(group.offset + group.count);
            if (loadedSplatCount > 0) await yieldToWorker();
          }
          groupBytes += group.bytes;
        }
        if (groupBytes !== descriptor.bytes) {
          throw new Error("4DGSのグループ長が一致しません。");
        }
        if (column === 11) {
          await normalizeRotations(values, header.count);
          shapeReady = true;
          publishGeometry(loadedSplatCount);
        }
        await yieldToWorker();
      }
      frameDataComplete = true;
      publishGeometry(loadedSplatCount);

      await loadAppearance(header.count, header.sh, readBytes, readChunk);

      for (let frame = 0; frame < header.frameCount; frame++) {
        const bounds = await readBytes(header.bounds[frame].bytes);
        depthBounds[frame] = new Float32Array(bounds.buffer);
      }
    };

    const normalizeRotations = async (values, count) => {
      for (let frame = 0; frame < values.length; frame++) {
        const rows = values[frame];
        for (let point = 0; point < count; point++) {
          const start = point * 12;
          const norm = Math.hypot(rows[start + 8], rows[start + 9], rows[start + 10], rows[start + 11]);
          if (norm > 0) {
            for (let axis = 8; axis < 12; axis++) rows[start + axis] /= norm;
          }
        }
        if (frame % 8 === 7) await yieldToWorker();
      }
    };

    const publishGeometry = (count) => {
      loadedSplatCount = count;
      geometryRevision += 1;
      self.postMessage({ type: "geometry", count, geometryRevision });
    };

    const load = async (data) => {
      const { scene, stream } = await loadScene(data);
      config = scene.config;
      textureWidth = data.textureWidth;
      previewScale = Math.hypot(...config.cameraPosition.map((value, index) => value - config.target[index])) * 0.0015;
      self.postMessage({ type: "scene", scene });
      await loadFrames(stream);
    };

    self.onmessage = ({ data }) => {
      if (data.type === "sort") {
        sortFrame(data);
      } else {
        load(data).catch((error) => self.postMessage({ type: "error", message: error.message }));
      }
    };
  };

  const createRenderer = (canvas, gl, textureWidth, scene, worker, lifetime, {
    interactionElement = canvas,
    onDraw,
    onLoadComplete,
    onInteractionEnd,
    onError
  } = {}) => {
    const { config } = scene;

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
    const pointers = new Map();
    let suppressDragContextMenu = false;
    const initialRadius = Math.hypot(...initialOffset);
    const initialYaw = Math.atan2(dot(initialOffset, config.basisRight), -dot(initialOffset, config.basisForward));
    const initialPitch = Math.asin(dot(initialOffset, config.basisUp) / initialRadius);
    let radius = initialRadius;
    let yaw = initialYaw;
    let pitch = initialPitch;
    let cameraReset;
    let active = false;
    let isLoading = true;
    let failed = false;
    let dirty = true;
    let animationFrame;
    let sortBusy = false;
    let viewRevision = 0;
    let sortedRevision = -1;
    let geometryRevision = 0;
    let sortedGeometryRevision = -1;
    let requestedFrame = 0;
    let activeFrame = -1;
    let renderedFrame = -1;
    let loadedSplatCount = 0;
    let activeSplatCount = 0;
    let framePreparation;

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
      if (failed) return;
      failed = true;
      active = false;
      cancelCameraReset();
      cancelFramePreparation();
      cancelAnimationFrame(animationFrame);
      lifetime.abort();
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
    const textureHeight = Math.ceil(config.maxCount * 3 / textureWidth);
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
    const shHeight = Math.ceil(config.count * 12 / textureWidth);
    const shTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, textureWidth, shHeight, 0, gl.RGBA, gl.FLOAT, null);
    gl.uniform1i(gl.getUniformLocation(program, "sharedShData"), 1);
    gl.activeTexture(gl.TEXTURE0);
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

    const getFrameHeight = (count) => Math.ceil(count * 3 / textureWidth);

    const uploadFrame = (index, order, values) => {
      if (values) {
        const height = getFrameHeight(order.length);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, textureWidth, height, gl.RGBA, gl.FLOAT, values);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, order);
      activeFrame = index;
      activeSplatCount = order.length;
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
        const splatCount = Math.min(frame.count, loadedSplatCount);
        if (!sortBusy && splatCount > 0 && (requestedFrame !== activeFrame
          || sortedRevision !== viewRevision || sortedGeometryRevision !== geometryRevision
          || splatCount !== activeSplatCount)) {
          const camera = cameraState(frame);
          worker.postMessage({
            type: "sort",
            planes: [...camera.forward, -dot(camera.forward, camera.position)],
            frame: requestedFrame,
            revision: viewRevision,
            activeFrame,
            activeGeometryRevision: sortedGeometryRevision
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
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, activeSplatCount);
          dirty = false;
          const error = gl.getError();
          if (error !== gl.NO_ERROR) {
            throw new Error(`4DGS描画エラー: ${error}`);
          }
          renderedFrame = activeFrame;
          onDraw?.(canvas, renderedFrame);
          if (framePreparation && activeFrame === framePreparation.index) {
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
      get isLoading() {
        return isLoading;
      },
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

    const trackCamera = (deltaX, deltaY) => {
      const camera = cameraState();
      const scale = 2 * radius * Math.tan(config.fov / 2) / Math.max(interactionElement.clientHeight, 1);
      for (let axis = 0; axis < 3; axis++) {
        target[axis] -= scale * (camera.right[axis] * deltaX / config.focalRatio + camera.down[axis] * deltaY);
      }
    };

    const { signal } = lifetime;
    document.addEventListener("pointerdown", () => {
      suppressDragContextMenu = false;
    }, { capture: true, signal });
    document.addEventListener("contextmenu", (event) => {
      if (suppressDragContextMenu) {
        suppressDragContextMenu = false;
        event.preventDefault();
      }
    }, { capture: true, signal });
    interactionElement.addEventListener("contextmenu", (event) => {
      if (active) event.preventDefault();
    }, { signal });
    interactionElement.addEventListener("pointerdown", (event) => {
      if (!active || (event.pointerType === "mouse" && event.button !== 0 && event.button !== 1 && event.button !== 2)) {
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
    }, { signal });

    interactionElement.addEventListener("pointermove", (event) => {
      const previous = pointers.get(event.pointerId);
      if (!active || !previous) {
        return;
      }
      event.preventDefault();
      const deltaX = event.clientX - previous.x;
      const deltaY = event.clientY - previous.y;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (event.pointerType === "mouse" && (event.buttons & (2 | 4))) {
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
    }, { signal });

    const endInteraction = (event) => {
      if (event.type === "lostpointercapture" && event.pointerType === "mouse"
        && event.buttons !== 0 && active && pointers.has(event.pointerId)) {
        interactionElement.setPointerCapture(event.pointerId);
        return;
      }
      if (event.type === "pointercancel") {
        suppressDragContextMenu = false;
      }
      if (pointers.delete(event.pointerId) && pointers.size === 0) {
        onInteractionEnd?.(event);
      }
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      interactionElement.addEventListener(type, endInteraction, { signal });
    }
    window.addEventListener("blur", () => {
      suppressDragContextMenu = false;
      const wasInteracting = pointers.size > 0;
      pointers.clear();
      if (wasInteracting) onInteractionEnd?.();
    }, { signal });
    interactionElement.addEventListener("wheel", (event) => {
      if (!active) return;
      event.preventDefault();
      cancelCameraReset();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? interactionElement.clientHeight : 1;
      const distance = radius * Math.exp(event.deltaY * scale * 0.001);
      if (distance > 0 && Number.isFinite(distance)) radius = distance;
      invalidateView();
    }, { passive: false, signal });
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      fail(new Error("4DGSの描画コンテキストが失われました。"));
    }, { signal });

    worker.onerror = (event) => fail(new Error(event.message));
    worker.onmessage = ({ data }) => {
      if (failed) return;
      switch (data.type) {
        case "geometry":
          loadedSplatCount = data.count;
          geometryRevision = data.geometryRevision;
          break;
        case "appearance":
          gl.activeTexture(gl.TEXTURE1);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, data.firstRow, textureWidth, data.height, gl.RGBA, gl.FLOAT, data.values);
          gl.activeTexture(gl.TEXTURE0);
          dirty = true;
          break;
        case "complete":
          isLoading = false;
          invalidateView();
          onLoadComplete?.();
          break;
        case "sorted":
          sortBusy = false;
          if ((cameraReset && data.revision !== viewRevision)
            || ((cameraReset || framePreparation) && data.frame !== requestedFrame)) break;
          uploadFrame(data.frame, data.order, data.values);
          sortedRevision = data.revision;
          sortedGeometryRevision = data.geometryRevision;
          break;
        case "error":
          fail(new Error(data.message));
          break;
      }
    };

    return controller;
  };

  window.createPuiGs = async (canvas, options) => {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true
    });
    if (!gl) throw new Error("WebGL 2を初期化できませんでした。");

    const textureWidth = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const local = location.protocol === "file:" ? await loadLocalScene() : undefined;
    const lifetime = new AbortController();
    try {
      const workerUrl = URL.createObjectURL(new Blob([`(${runWorker.toString()})();`], { type: "text/javascript" }));
      let worker;
      try {
        worker = new Worker(workerUrl);
      } finally {
        URL.revokeObjectURL(workerUrl);
      }
      lifetime.signal.addEventListener("abort", () => worker.terminate(), { once: true });
      const scene = await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => {
          if (data.type === "scene") resolve(data.scene);
          else reject(new Error(data.message));
        };
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage({ type: "load", url: sceneUrl, local, textureWidth });
      });
      return createRenderer(canvas, gl, textureWidth, scene, worker, lifetime, options);
    } catch (error) {
      lifetime.abort();
      throw error;
    }
  };
})();
