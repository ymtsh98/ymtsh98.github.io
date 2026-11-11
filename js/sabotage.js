(() => {
  "use strict";

  const media = document.querySelector(".sabotage");
  const canvas = media.querySelector(".sabotageView");
  const loadingStatus = media.querySelector(".puiViewerStatus");
  const dataUrl = new URL("../images/2026/sabotage-data.js?v=20261111-remaining-1", document.currentScript.src).href;
  const firstColor = window.sabotageFirstFrame ? readPayload(window.sabotageFirstFrame) : null;
  delete window.sabotageFirstFrame;
  const ambientCanvas = document.createElement("canvas");
  ambientCanvas.width = 64;
  ambientCanvas.height = 64;
  const ambientContext = ambientCanvas.getContext("2d");
  const ambientFrame = document.createElement("canvas");
  ambientFrame.width = ambientCanvas.width;
  ambientFrame.height = ambientCanvas.height;
  const ambientFrameContext = ambientFrame.getContext("2d");
  const paperColor = getComputedStyle(document.body).backgroundColor;

  const tau = Math.PI * 2;
  const frameCount = 120;
  const colorFrameDuration = 1000000 / 48;
  const imageWidth = 640;
  const imageHeight = 1152;
  const depthWidth = 160;
  const depthHeight = 288;
  const depthPixels = depthWidth * depthHeight;
  const radius = 3;
  const effects = {
    chromaticStrength: 2,
    vhsStrength: 1,
    idleVhsStrength: 0.35,
    lensDistortion: 0.1,
    vignetteStrength: 0.6
  };
  const frames = [];
  const cache = new Map();
  let yaw = 0;
  let pitch = 0;
  let dirty = true;
  let ready = false;
  let showingFirstFrame = false;
  let colors;
  let gl;
  let splatProgram;
  let resolveProgram;
  let resolveUniforms;
  let splatUniforms;
  let splatVao;
  let framebuffer;
  let accumulation;
  let useFloatAccumulation;
  let accumulationWidth = 0;
  let accumulationHeight = 0;
  let chromaticStrength = 0;
  let effectUpdatedAt = performance.now();
  let lastMotionAt = -Infinity;
  let animationFrame = 0;
  let ambientLayoutFrame = 0;
  let ambientFramePosition;
  let isHovered = false;
  let isTouchActive = false;
  let isAmbientVisible = false;
  let touchStart;
  let drag;
  let animationLoad;
  let isLoadingAnimation = false;

  const splatVertex = `#version 300 es
  precision highp float;
  precision highp int;
  uniform sampler2D sourceColor;
  uniform sampler2D otherColor;
  uniform sampler2D sourceDepth;
  uniform sampler2D otherDepth;
  uniform sampler2D sourceFlow;
  uniform sampler2D otherFlow;
  uniform vec2 imageSize;
  uniform vec2 viewport;
  uniform float sourceAngle;
  uniform float otherAngle;
  uniform float phase;
  uniform float angularWeight;
  uniform float focalLength;
  uniform float screenFocal;
  uniform vec2 panOffset;
  uniform vec3 cameraPosition;
  uniform mat3 viewRotation;
  uniform bool reverseFlow;
  in vec2 corner;
  out vec2 gaussianPosition;
  flat out vec4 gaussianColor;

  vec3 worldPoint(vec2 pixel, float depth, float angle) {
    vec3 right = vec3(cos(angle), 0.0, -sin(angle));
    vec3 forward = vec3(-sin(angle), 0.0, -cos(angle));
    vec3 center = -3.0 * forward;
    return center + forward * depth + right * ((pixel.x - imageSize.x * 0.5) * depth / focalLength) + vec3(0.0, -(pixel.y - imageSize.y * 0.5) * depth / focalLength, 0.0);
  }

  void main() {
    int width = int(imageSize.x);
    vec2 pixel = vec2(float(gl_InstanceID % width), float(gl_InstanceID / width)) + 0.5;
    vec2 uv = pixel / imageSize;
    vec4 flows = texture(sourceFlow, uv);
    vec2 flow = (reverseFlow ? flows.zw : flows.xy) * 2.0;
    vec2 pairedPixel = pixel + flow;
    vec2 pairedUv = pairedPixel / imageSize;
    vec4 otherFlows = texture(otherFlow, pairedUv);
    vec2 returnFlow = (reverseFlow ? otherFlows.xy : otherFlows.zw) * 2.0;
    float disagreement = length(flow + returnFlow);
    float confidence = exp(-0.02 * disagreement * disagreement);
    float inside = float(all(greaterThanEqual(pairedUv, vec2(0.0))) && all(lessThanEqual(pairedUv, vec2(1.0))));
    float matchWeight = confidence * inside;
    float movePhase = phase * matchWeight;
    float depthA = 2.7 + 0.6 * texture(sourceDepth, uv).r;
    float depthB = 2.7 + 0.6 * texture(otherDepth, pairedUv).r;
    vec3 worldA = worldPoint(pixel, depthA, sourceAngle);
    vec3 worldB = worldPoint(pairedPixel, depthB, otherAngle);
    vec3 position = mix(worldA, worldB, movePhase);
    vec3 cameraPoint = viewRotation * (position - cameraPosition);
    gaussianColor = vec4(0.0);
    gaussianPosition = vec2(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    if (cameraPoint.z < 0.01 || angularWeight <= 0.0) return;
    float depth = mix(depthA, depthB, movePhase);
    vec2 texelX = vec2(1.0 / imageSize.x, 0.0);
    vec2 texelY = vec2(0.0, 1.0 / imageSize.y);
    vec3 neighborAX = worldPoint(pixel + vec2(1.0, 0.0), 2.7 + 0.6 * texture(sourceDepth, uv + texelX).r, sourceAngle);
    vec3 neighborAY = worldPoint(pixel + vec2(0.0, 1.0), 2.7 + 0.6 * texture(sourceDepth, uv + texelY).r, sourceAngle);
    vec3 neighborBX = worldPoint(pairedPixel + vec2(1.0, 0.0), 2.7 + 0.6 * texture(otherDepth, pairedUv + texelX).r, otherAngle);
    vec3 neighborBY = worldPoint(pairedPixel + vec2(0.0, 1.0), 2.7 + 0.6 * texture(otherDepth, pairedUv + texelY).r, otherAngle);
    vec3 tangentX = viewRotation * (0.52 * mix(neighborAX - worldA, neighborBX - worldB, movePhase));
    vec3 tangentY = viewRotation * (0.52 * mix(neighborAY - worldA, neighborBY - worldB, movePhase));
    float inverseZ = 1.0 / cameraPoint.z;
    vec2 slope = clamp(cameraPoint.xy * inverseZ, -1.3 * viewport / (2.0 * screenFocal), 1.3 * viewport / (2.0 * screenFocal));
    vec3 jacobianX = vec3(screenFocal * inverseZ, 0.0, -screenFocal * slope.x * inverseZ);
    vec3 jacobianY = vec3(0.0, screenFocal * inverseZ, -screenFocal * slope.y * inverseZ);
    vec2 axisX = vec2(dot(jacobianX, tangentX), dot(jacobianY, tangentX));
    vec2 axisY = vec2(dot(jacobianX, tangentY), dot(jacobianY, tangentY));
    float a = axisX.x * axisX.x + axisY.x * axisY.x + 0.12;
    float b = axisX.x * axisX.y + axisY.x * axisY.y;
    float d = axisX.y * axisX.y + axisY.y * axisY.y + 0.12;
    float middle = 0.5 * (a + d);
    float spread = length(vec2(0.5 * (a - d), b));
    float orientation = 0.5 * atan(2.0 * b, a - d);
    vec2 direction = vec2(cos(orientation), sin(orientation));
    vec2 major = direction * sqrt(max(middle + spread, 0.01));
    vec2 minor = vec2(-direction.y, direction.x) * sqrt(max(middle - spread, 0.01));
    gaussianPosition = corner * 3.0;
    vec2 offset = major * gaussianPosition.x + minor * gaussianPosition.y;
    vec2 projected = screenFocal * cameraPoint.xy * inverseZ + offset + panOffset;
    gl_Position = vec4(2.0 * projected.x / viewport.x, -2.0 * projected.y / viewport.y, 0.0, 1.0);
    vec3 colorA = texture(sourceColor, uv).rgb;
    vec3 colorB = texture(otherColor, pairedUv).rgb;
    float visibility = angularWeight * mix(1.0, max(matchWeight, 0.02), phase);
    gaussianColor = vec4(mix(colorA, colorB, movePhase), visibility * exp(-0.8 * (cameraPoint.z - 2.7)));
  }
  `;

  const splatFragment = `#version 300 es
  precision highp float;
  in vec2 gaussianPosition;
  flat in vec4 gaussianColor;
  uniform float accumulationScale;
  out vec4 outputColor;
  void main() {
    float weight = accumulationScale * gaussianColor.a * exp(-0.5 * dot(gaussianPosition, gaussianPosition));
    outputColor = vec4(gaussianColor.rgb * weight, weight);
  }
  `;

  const resolveVertex = `#version 300 es
  precision highp float;
  out vec2 uv;
  void main() {
    vec2 point = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    uv = point;
    gl_Position = vec4(point * 2.0 - 1.0, 0.0, 1.0);
  }
  `;

  const resolveFragment = `#version 300 es
  precision highp float;
  uniform sampler2D accumulation;
  uniform vec2 resolution;
  uniform bool isFirstFrame;
  uniform vec2 firstFrameScale;
  uniform float chromaticStrength;
  uniform float lensDistortion;
  uniform float vignetteStrength;
  uniform float vhsStrength;
  uniform float time;
  in vec2 uv;
  out vec4 outputColor;
  vec4 sampleView(vec2 point) {
    if (!isFirstFrame) return texture(accumulation, point);

    vec2 sourceUv = (point - 0.5) / firstFrameScale + 0.5;
    if (any(lessThan(sourceUv, vec2(0.0))) || any(greaterThan(sourceUv, vec2(1.0)))) return vec4(0.0);
    return texture(accumulation, vec2(sourceUv.x, 1.0 - sourceUv.y));
  }

  vec3 resolvedColor(vec2 point) {
    vec4 value = sampleView(point);
    return value.a > 0.001 ? value.rgb / value.a : vec3(0.063, 0.067, 0.086);
  }
  vec2 lensUv(vec2 point) {
    float aspect = resolution.x / resolution.y;
    vec2 centered = (point - 0.5) * vec2(aspect, 1.0) * 2.0;
    float radius = dot(centered, centered) / (aspect * aspect + 1.0);
    return (point - 0.5) * ((1.0 + lensDistortion * radius) / (1.0 + lensDistortion)) + 0.5;
  }

  float randomValue(vec2 point) {
    vec3 value = fract(vec3(point.xyx) * 0.1031);
    value += dot(value, value.yzx + 33.33);
    return fract((value.x + value.y) * value.z);
  }
  void main() {
    float field = floor(time * 60.0);
    float line = floor(uv.y * 480.0);
    vec2 signalUv = lensUv(uv);
    if (vhsStrength > 0.0) {
      float trackingDistance = abs(fract(uv.y + time * 0.23 + 0.5) - 0.5);
      float tracking = exp(-trackingDistance * trackingDistance / 0.000035);
      float jitter = (randomValue(vec2(line, field)) - 0.5) * 0.0008;
      float tear = (randomValue(vec2(floor(line / 3.0), field)) - 0.5) * tracking * 0.045;
      float headSwitch = 1.0 - smoothstep(0.0, 0.022, uv.y);
      signalUv.x += (jitter + tear + headSwitch * sin(line * 0.7 + field) * 0.008) * vhsStrength;
    }
    vec4 signal = sampleView(signalUv);
    if (signal.a <= 0.001) {
      outputColor = vec4(0.0);
      return;
    }
    vec3 color = signal.rgb / signal.a;
    if (chromaticStrength > 0.0) {
      vec2 offset = (uv - 0.5) * 0.012 * chromaticStrength;
      color.r = resolvedColor(signalUv + offset).r;
      color.b = resolvedColor(signalUv - offset).b;
    }
    if (vhsStrength > 0.0) {
      vec3 lumaWeights = vec3(0.299, 0.587, 0.114);
      vec2 chromaOffset = vec2(2.5 / 720.0, 0.0);
      vec3 bleed = resolvedColor(signalUv - chromaOffset) * 0.5;
      bleed += resolvedColor(signalUv - chromaOffset * 2.0) * 0.3;
      bleed += resolvedColor(signalUv - chromaOffset * 3.0) * 0.2;
      vec3 tapeColor = vec3(dot(color, lumaWeights)) + (bleed - dot(bleed, lumaWeights)) * 0.85;
      color = mix(color, tapeColor, vhsStrength * 0.8);
      float dropoutLine = step(0.994, randomValue(vec2(line, field + 91.0)));
      float start = randomValue(vec2(line + 37.0, field)) * 0.85;
      float length = 0.04 + randomValue(vec2(line + 73.0, field)) * 0.2;
      float streak = smoothstep(start, start + 0.002, uv.x) * (1.0 - smoothstep(start + length * 0.35, start + length, uv.x));
      float noise = randomValue(vec2(floor(uv.x * resolution.x / 3.0), line + field * 13.0));
      color = mix(color, vec3(0.7 + noise * 0.3), dropoutLine * streak * vhsStrength * 0.8);
      color *= 1.0 + (randomValue(vec2(line, field + 7.0)) - 0.5) * 0.025 * vhsStrength;
    }
    vec2 edge = (uv - 0.5) * 2.0;
    float vignette = 1.0 - vignetteStrength * smoothstep(0.25, 1.9, dot(edge, edge));
    color *= vignette;
    outputColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
  `;

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  function fail(error) {
    ready = false;
    setAnimationLoading(false);
    if (!showingFirstFrame || gl?.isContextLost()) {
      canvas.hidden = true;
      stopAmbient(true);
    }
    setTouchActive(false);
    console.error(error);
  }

  function angleFrame() {
    return ((yaw / tau % 1) + 1) % 1 * frameCount;
  }

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }

  function program(vertexSource, fragmentSource) {
    const value = gl.createProgram();
    gl.attachShader(value, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(value, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(value);
    if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(value));
    return value;
  }

  function texture(internalFormat, width, height, format, type, data) {
    const value = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, value);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
    return value;
  }

  function predict(left, up, corner) {
    return Math.max(Math.min(left, up), Math.min(Math.max(left, up), left + up - corner));
  }

  function decodeDepth(frame, depthStart) {
    const depth = new Uint8Array(depthPixels);
    for (let i = 0; i < depthPixels; i++) {
      const hasLeft = i % depthWidth !== 0;
      const hasUp = i >= depthWidth;
      const left = hasLeft ? depth[i - 1] : 0;
      const up = hasUp ? depth[i - depthWidth] : 0;
      const corner = hasLeft && hasUp ? depth[i - depthWidth - 1] : 0;
      depth[i] = frame[depthStart + i] + predict(left, up, corner);
    }
    return depth;
  }

  function decodeFlow(frame, flowStart) {
    const values = new Int16Array(depthPixels * 4);
    for (let channel = 0; channel < 4; channel++) {
      const lowStart = flowStart + channel * 2 * depthPixels;
      const highStart = lowStart + depthPixels;
      for (let i = 0; i < depthPixels; i++) {
        const offset = i * 4 + channel;
        const hasLeft = i % depthWidth !== 0;
        const hasUp = i >= depthWidth;
        const left = hasLeft ? values[offset - 4] : 0;
        const up = hasUp ? values[offset - depthWidth * 4] : 0;
        const corner = hasLeft && hasUp ? values[offset - (depthWidth + 1) * 4] : 0;
        const encoded = frame[lowStart + i] | (frame[highStart + i] << 8);
        const difference = (encoded >>> 1) ^ -(encoded & 1);
        values[offset] = difference + predict(left, up, corner);
      }
    }
    return values;
  }

  function readPayload(encoded) {
    if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(encoded);
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < bytes.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function copyColorFrame(frame) {
    try {
      if (frame.format === null) return await createImageBitmap(frame);
      try {
        const bytes = new Uint8Array(frame.allocationSize());
        const layout = await frame.copyTo(bytes);
        return new VideoFrame(bytes, {
          format: frame.format,
          codedWidth: frame.visibleRect.width,
          codedHeight: frame.visibleRect.height,
          displayWidth: frame.displayWidth,
          displayHeight: frame.displayHeight,
          colorSpace: frame.colorSpace.toJSON(),
          timestamp: frame.timestamp,
          layout
        });
      } catch {
        return await createImageBitmap(frame);
      }
    } finally {
      frame.close();
    }
  }

  function decodeColorPackets(decoder, bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    while (offset < bytes.length) {
      const index = view.getUint32(offset, true);
      const size = view.getUint32(offset + 4, true);
      const type = bytes[offset + 8] === 1 ? "key" : "delta";
      offset += 9;
      if (offset + size > bytes.length) throw new Error("画像データが途中で終わっています。");
      const timestamp = Math.round(index * colorFrameDuration);
      const duration = Math.round((index + 1) * colorFrameDuration) - timestamp;
      decoder.decode(new EncodedVideoChunk({type, timestamp, duration, data: bytes.subarray(offset, offset + size)}));
      offset += size;
    }
  }

  async function preloadColors(remaining) {
    if (typeof VideoDecoder === "undefined") throw new Error("このブラウザではWebCodecsを利用できません。");
    if (!firstColor) throw new Error("sabotage の先頭フレームを読み込めませんでした。");
    const view = new DataView(firstColor.buffer, firstColor.byteOffset, firstColor.byteLength);
    const descriptionEnd = 4 + view.getUint32(0, true);
    const config = {
      codec: "avc1.64001f",
      codedWidth: 640,
      codedHeight: 1152,
      description: firstColor.subarray(4, descriptionEnd)
    };
    if (!(await VideoDecoder.isConfigSupported(config)).supported) throw new Error("このブラウザではH.264をデコードできません。");
    const copies = [];
    const colors = [];
    let failure;
    const decoder = new VideoDecoder({
      output(frame) {
        const index = Math.round(frame.timestamp / colorFrameDuration);
        const copy = copyColorFrame(frame).then(color => {
          colors[index] = color;
        }).catch(error => {
          failure ??= error;
        });
        copies.push(copy);
      },
      error(error) {
        failure ??= error;
      }
    });
    try {
      decoder.configure(config);
      decodeColorPackets(decoder, firstColor.subarray(descriptionEnd));
      if (remaining) decodeColorPackets(decoder, readPayload(remaining));
      await decoder.flush();
      await Promise.all(copies);
      if (failure) throw failure;
      const count = remaining ? frameCount : 1;
      for (let index = 0; index < count; index++) {
        if (!colors[index]) throw new Error("画像のコマ数が一致しません。");
      }
      return colors;
    } catch (error) {
      if (decoder.state !== "closed") decoder.close();
      await Promise.all(copies);
      colors.forEach(color => color.close());
      throw error;
    } finally {
      if (decoder.state !== "closed") decoder.close();
    }
  }

  async function showFirstFrame() {
    try {
      const [frame] = await preloadColors();
      try {
        if (ready) return;

        initializeDisplay();
        canvas.width = imageWidth;
        canvas.height = imageHeight;
        const source = colorTexture(frame);
        try {
          presentView(false, source);
          showingFirstFrame = true;
          canvas.hidden = false;
          captureAmbientFrame(0, frame);
          if (effectsAreActive()) updateAmbient();
        } finally {
          gl.deleteTexture(source);
        }
      } finally {
        frame.close();
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function preloadFrames(encoded) {
    const compressed = readPayload(encoded);
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
    const reader = stream.getReader();
    let chunk = new Uint8Array();
    let cursor = 0;
    async function readBytes(length) {
      const bytes = new Uint8Array(length);
      let written = 0;
      while (written < length) {
        if (cursor === chunk.length) {
          const next = await reader.read();
          if (next.done) throw new Error("フレームデータが途中で終わっています。");
          chunk = next.value;
          cursor = 0;
        }
        const count = Math.min(length - written, chunk.length - cursor);
        bytes.set(chunk.subarray(cursor, cursor + count), written);
        cursor += count;
        written += count;
      }
      return bytes;
    }

    const header = new DataView((await readBytes(16)).buffer);
    if (header.getUint32(0, true) !== frameCount || header.getUint32(4, true) !== imageWidth ||
        header.getUint32(8, true) !== imageHeight || header.getUint32(12, true) !== depthWidth) {
      throw new Error("フレームデータの形式が一致しません。");
    }
    for (let index = 0; index < frameCount; index++) {
      const depthAndFlow = await readBytes(depthPixels * 9);
      frames.push({
        depth: Uint8Array.from(decodeDepth(depthAndFlow, 0), value => value * 3),
        flow: decodeFlow(depthAndFlow, depthPixels)
      });
    }
    if (cursor < chunk.length || !(await reader.read()).done) throw new Error("データの長さが一致しません。");
  }

  function colorTexture(frame) {
    const color = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, color);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    return color;
  }

  function loadFrame(index) {
    const stored = cache.get(index);
    if (stored) {
      stored.used = performance.now();
      return stored.textures;
    }

    const frame = frames[index];
    const color = colorTexture(colors[index]);
    const depth = texture(gl.R8, depthWidth, depthHeight, gl.RED, gl.UNSIGNED_BYTE, frame.depth);
    const flow = texture(gl.RGBA16F, depthWidth, depthHeight, gl.RGBA, gl.FLOAT, Float32Array.from(frame.flow));
    const textures = {color, depth, flow};
    cache.set(index, {used: performance.now(), textures});
    return textures;
  }

  function trimCache(protectedIds) {
    const candidates = [...cache.entries()].filter(([index]) => !protectedIds.includes(index)).sort((a, b) => a[1].used - b[1].used);
    while (cache.size > 10 && candidates.length) {
      const [index, entry] = candidates.shift();
      Object.values(entry.textures).forEach(value => gl.deleteTexture(value));
      cache.delete(index);
    }
  }

  function resize() {
    const scale = devicePixelRatio || 1;
    const width = Math.max(1, Math.round(media.clientWidth * scale));
    const height = Math.max(1, Math.round(media.clientHeight * scale));
    if (width === accumulationWidth && height === accumulationHeight) return;
    canvas.width = width;
    canvas.height = height;
    if (accumulation) gl.deleteTexture(accumulation);
    const format = useFloatAccumulation ? gl.RGBA16F : gl.RGBA8;
    const type = useFloatAccumulation ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    accumulation = texture(format, width, height, gl.RGBA, type, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accumulation, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("描画バッファを作成できませんでした。");
    accumulationWidth = width;
    accumulationHeight = height;
    dirty = true;
  }

  function bindTexture(unit, value, name) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, value);
    gl.uniform1i(splatUniforms[name], unit);
  }

  function getLensFramingScale(width, height) {
    const aspectSquared = (width / height) ** 2;
    const edgeRadius = Math.min(aspectSquared, 1) / (aspectSquared + 1);
    return (1 + effects.lensDistortion * edgeRadius) / (1 + effects.lensDistortion);
  }

  function getViewFramingScale() {
    return 1 - (1 - getLensFramingScale(canvas.width, canvas.height)) / 3;
  }

  function renderView() {
    const frame = angleFrame();
    const first = Math.floor(frame) % frameCount;
    const second = (first + 1) % frameCount;
    const phase = frame - Math.floor(frame);
    const a = loadFrame(first);
    const b = loadFrame(second);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(splatProgram);
    gl.bindVertexArray(splatVao);
    gl.uniform1f(splatUniforms.accumulationScale, useFloatAccumulation ? 1 : 0.25);
    const offset = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
    const forward = offset.map(value => -value);
    const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const down = cross(forward, right);
    const rotation = [right[0], down[0], forward[0], right[1], down[1], forward[1], right[2], down[2], forward[2]];
    gl.uniformMatrix3fv(splatUniforms.viewRotation, false, rotation);
    gl.uniform3fv(splatUniforms.cameraPosition, offset.map(value => value * radius));
    gl.uniform2f(splatUniforms.imageSize, imageWidth, imageHeight);
    gl.uniform2f(splatUniforms.viewport, canvas.width, canvas.height);
    gl.uniform1f(splatUniforms.focalLength, imageHeight / (2 * Math.tan(Math.PI / 6)));
    gl.uniform1f(splatUniforms.screenFocal, getViewFramingScale() * canvas.height / (2 * Math.tan(Math.PI / 6)));
    for (const [source, other, sourceIndex, otherIndex, localPhase, weight, reverse] of [[a, b, first, first + 1, phase, 1 - phase, false], [b, a, first + 1, first, 1 - phase, phase, true]]) {
      if (weight <= 0) continue;
      bindTexture(0, source.color, "sourceColor");
      bindTexture(1, other.color, "otherColor");
      bindTexture(2, source.depth, "sourceDepth");
      bindTexture(3, other.depth, "otherDepth");
      bindTexture(4, source.flow, "sourceFlow");
      bindTexture(5, other.flow, "otherFlow");
      gl.uniform1f(splatUniforms.sourceAngle, sourceIndex * tau / frameCount);
      gl.uniform1f(splatUniforms.otherAngle, otherIndex * tau / frameCount);
      gl.uniform1f(splatUniforms.phase, localPhase);
      gl.uniform1f(splatUniforms.angularWeight, weight);
      gl.uniform1i(splatUniforms.reverseFlow, reverse);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, imageWidth * imageHeight);
    }
    trimCache([first, second]);
  }

  function decayEffect() {
    const now = performance.now();
    chromaticStrength *= Math.exp(-(now - effectUpdatedAt) / 100);
    if (chromaticStrength < 0.002) chromaticStrength = 0;
    effectUpdatedAt = now;
  }

  function presentView(hasVhsNoise, firstFrameTexture) {
    decayEffect();
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(resolveProgram);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, firstFrameTexture || accumulation);
    gl.uniform1i(resolveUniforms.accumulation, 0);
    gl.uniform2f(resolveUniforms.resolution, canvas.width, canvas.height);
    gl.uniform1i(resolveUniforms.isFirstFrame, firstFrameTexture ? 1 : 0);
    if (firstFrameTexture) {
      const scale = getViewFramingScale();
      const scaleX = scale * canvas.height * imageWidth / (canvas.width * imageHeight);
      gl.uniform2f(resolveUniforms.firstFrameScale, scaleX, scale);
    }
    gl.uniform1f(resolveUniforms.chromaticStrength, chromaticStrength * effects.chromaticStrength);
    gl.uniform1f(resolveUniforms.lensDistortion, effects.lensDistortion);
    gl.uniform1f(resolveUniforms.vignetteStrength, effects.vignetteStrength);
    const motionFade = Math.min(1, Math.max(0, (110 - (performance.now() - lastMotionAt)) / 60));
    const vhsStrength = hasVhsNoise ? Math.max(effects.idleVhsStrength, chromaticStrength * motionFade) : 0;
    gl.uniform1f(resolveUniforms.vhsStrength, vhsStrength * effects.vhsStrength);
    gl.uniform1f(resolveUniforms.time, performance.now() * 0.001);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`描画エラー: ${error}`);
  }

  function moveView(nextYaw, nextPitch) {
    const dx = (nextYaw - yaw) / tau * media.clientWidth;
    const dy = (nextPitch - pitch) / Math.PI * media.clientHeight;
    const motion = Math.hypot(dx, dy) / 24;
    if (motion === 0) return;

    decayEffect();
    lastMotionAt = performance.now();
    chromaticStrength = 1 - (1 - chromaticStrength) * Math.exp(-motion);
    yaw = nextYaw;
    pitch = nextPitch;
    dirty = true;
    requestRender();
  }

  function requestRender() {
    if (ready && !animationFrame) animationFrame = requestAnimationFrame(render);
  }

  function getAmbientSections(sourceSize, targetSize, start, end, insetRatio) {
    const inset = Math.round(sourceSize * insetRatio);
    const targetInset = (end - start) * inset / sourceSize;
    const innerStart = start + targetInset;
    const innerEnd = end - targetInset;
    return [
      {source: inset, sourceSize: 1, target: 0, targetSize: innerStart},
      {source: inset, sourceSize: sourceSize - 2 * inset, target: innerStart, targetSize: innerEnd - innerStart},
      {source: sourceSize - inset - 1, sourceSize: 1, target: innerEnd, targetSize: targetSize - innerEnd}
    ];
  }

  function drawAmbient(context, {width, height}) {
    const imageBounds = media.getBoundingClientRect();
    if (!imageBounds.width || !imageBounds.height) return;

    const padding = 72;
    const paddedWidth = width + 2 * padding;
    const paddedHeight = height + 2 * padding;
    const scaleX = ambientCanvas.width / paddedWidth;
    const scaleY = ambientCanvas.height / paddedHeight;
    const insetRatio = (1 - getLensFramingScale(imageBounds.width, imageBounds.height)) / 2;
    const columns = getAmbientSections(
      ambientFrame.width, ambientCanvas.width,
      (imageBounds.left + padding) * scaleX, (imageBounds.right + padding) * scaleX, insetRatio
    );
    const rows = getAmbientSections(
      ambientFrame.height, ambientCanvas.height,
      (imageBounds.top + padding) * scaleY, (imageBounds.bottom + padding) * scaleY, insetRatio
    );

    ambientContext.clearRect(0, 0, ambientCanvas.width, ambientCanvas.height);
    for (const row of rows) {
      for (const column of columns) {
        if (column.targetSize <= 0 || row.targetSize <= 0) continue;

        ambientContext.drawImage(
          ambientFrame,
          column.source, row.source, column.sourceSize, row.sourceSize,
          column.target, row.target, column.targetSize, row.targetSize
        );
      }
    }

    context.save();
    context.fillStyle = paperColor;
    context.fillRect(0, 0, width, height);
    context.globalAlpha = 0.55;
    context.filter = "blur(40px)";
    context.drawImage(ambientCanvas, -padding, -padding, paddedWidth, paddedHeight);
    context.restore();
  }

  function captureAmbientFrame(position, source, next) {
    if (!ambientFrameContext) return;

    const {width, height} = ambientFrame;
    ambientFrameContext.clearRect(0, 0, width, height);
    ambientFrameContext.drawImage(source, 0, 0, width, height);
    const phase = position - Math.floor(position);
    if (phase && next) {
      ambientFrameContext.save();
      ambientFrameContext.globalAlpha = phase;
      ambientFrameContext.drawImage(next, 0, 0, width, height);
      ambientFrameContext.restore();
    }
    ambientFramePosition = position;
  }

  function updateAmbient() {
    if (!ambientContext || !ambientFrameContext || canvas.hidden) return;

    const position = ready ? angleFrame() : 0;
    if (ready && position !== ambientFramePosition) {
      const first = Math.floor(position);
      captureAmbientFrame(position, colors[first], colors[(first + 1) % frameCount]);
    } else if (ambientFramePosition === undefined || isAmbientVisible) {
      return;
    }
    if (!isAmbientVisible) {
      window.galleryEffects?.activate("sabotage");
      isAmbientVisible = true;
    }
    window.siteBackgroundEffects?.paintBackground(drawAmbient);
  }

  function stopAmbient(restoreGrid) {
    if (!isAmbientVisible) return;

    isAmbientVisible = false;
    window.siteBackgroundEffects?.releaseBackground(drawAmbient, restoreGrid);
  }

  function scheduleAmbientLayout() {
    if (ambientLayoutFrame || !isAmbientVisible) return;

    ambientLayoutFrame = requestAnimationFrame(() => {
      ambientLayoutFrame = 0;
      if (isAmbientVisible) window.siteBackgroundEffects?.paintBackground(drawAmbient);
    });
  }

  function render() {
    animationFrame = 0;
    if (!ready) return;

    try {
      showingFirstFrame = false;
      resize();
      const viewChanged = dirty;
      if (viewChanged) {
        renderView();
        dirty = false;
      }
      const effectsActive = effectsAreActive();
      presentView(effectsActive);
      if (canvas.hidden) canvas.hidden = false;
      if (isLoadingAnimation) setAnimationLoading(false);
      if (effectsActive && viewChanged) updateAmbient();
      if (effectsActive || chromaticStrength > 0) requestRender();
    } catch (error) {
      fail(error);
    }
  }

  function effectsAreActive() {
    return isHovered || isTouchActive || Boolean(drag);
  }

  function updateInteraction(target) {
    if (effectsAreActive()) {
      if (!isAmbientVisible) updateAmbient();
    } else {
      const nextTile = target?.closest?.(".gallery > .tile:not(.sabotageTile)");
      stopAmbient(!nextTile);
    }
    requestRender();
  }

  function setHovered(hovered, target) {
    if (isHovered === hovered) return;

    isHovered = hovered;
    if (hovered) preloadAnimation("high");
    updateLoadingStatus();
    updateInteraction(target);
  }

  function setTouchActive(active, target) {
    if (isTouchActive === active) return;

    isTouchActive = active;
    media.classList.toggle("isTouchActive", active && ready);
    if (active) preloadAnimation("high");
    updateLoadingStatus();
    updateInteraction(target);
  }

  window.addEventListener("scroll", scheduleAmbientLayout, {passive: true});
  document.addEventListener("pointerdown", event => {
    if (event.pointerType === "touch" && event.isPrimary && !media.contains(event.target)) {
      setTouchActive(false, event.target);
    }
  });

  media.addEventListener("pointerenter", event => {
    if (event.pointerType !== "touch") setHovered(true);
  });
  media.addEventListener("pointerleave", event => {
    if (event.pointerType !== "touch") setHovered(false, event.relatedTarget);
  });

  media.addEventListener("pointerdown", event => {
    if (event.pointerType === "touch") {
      if (!event.isPrimary || drag) return;

      if (!isTouchActive) {
        touchStart = {id: event.pointerId, x: event.clientX, y: event.clientY};
        return;
      }
    }

    if (event.button !== 0 || !ready) return;

    event.preventDefault();
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY};
    media.setPointerCapture(event.pointerId);
    updateInteraction();
  });

  media.addEventListener("pointermove", event => {
    if (touchStart?.id === event.pointerId) {
      if (Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y) > 8) touchStart = undefined;
      return;
    }

    if (!ready || drag?.id !== event.pointerId || (event.pointerType !== "touch" && !(event.buttons & 1))) return;

    if (event.pointerType !== "touch") {
      const {left, right, top, bottom} = media.getBoundingClientRect();
      setHovered(event.clientX >= left && event.clientX < right && event.clientY >= top && event.clientY < bottom);
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    moveView(yaw - dx * tau / media.clientWidth, pitch + dy * Math.PI / media.clientHeight);
  });

  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    media.addEventListener(type, event => {
      if (touchStart?.id === event.pointerId) {
        const distance = Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y);
        touchStart = undefined;
        if (type === "pointerup" && distance <= 8) setTouchActive(true);
      }
      if (drag?.id !== event.pointerId) return;

      drag = undefined;
      const target = type === "pointerup" ? document.elementFromPoint(event.clientX, event.clientY) : null;
      if (type === "pointerup" && event.pointerType !== "touch") isHovered = media.contains(target);
      updateInteraction(target);
    });
  }

  media.addEventListener("wheel", event => {
    if (!ready) return;
    event.preventDefault();

    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? media.clientHeight : 1;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    moveView(yaw - delta * unit * tau / (100 * frameCount), pitch);
  }, {passive: false});

  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    fail(new Error("描画コンテキストが失われました。再読み込みしてください。"));
  });

  function initializeDisplay() {
    if (resolveProgram) return;

    gl = canvas.getContext("webgl2", {alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true});
    if (!gl) throw new Error("WebGL 2に対応したブラウザで開いてください。");
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    resolveProgram = program(resolveVertex, resolveFragment);
    resolveUniforms = Object.fromEntries(["accumulation", "resolution", "isFirstFrame", "firstFrameScale", "chromaticStrength", "lensDistortion", "vignetteStrength", "vhsStrength", "time"].map(name => [name, gl.getUniformLocation(resolveProgram, name)]));
  }

  async function initialize(data) {
    initializeDisplay();
    useFloatAccumulation = Boolean(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
    splatProgram = program(splatVertex, splatFragment);
    const names = ["sourceColor", "otherColor", "sourceDepth", "otherDepth", "sourceFlow", "otherFlow", "imageSize", "viewport", "sourceAngle", "otherAngle", "phase", "angularWeight", "focalLength", "screenFocal", "cameraPosition", "viewRotation", "reverseFlow", "accumulationScale"];
    splatUniforms = Object.fromEntries(names.map(name => [name, gl.getUniformLocation(splatProgram, name)]));
    splatVao = gl.createVertexArray();
    gl.bindVertexArray(splatVao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(splatProgram, "corner");
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    framebuffer = gl.createFramebuffer();
    [colors] = await Promise.all([preloadColors(data.color), preloadFrames(data.geometry)]);
    ready = true;
    media.classList.toggle("isTouchActive", isTouchActive);
    new ResizeObserver(requestRender).observe(media);
    requestRender();
  }

  function loadAnimationData(priority) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = dataUrl;
      script.fetchPriority = priority;
      script.onload = () => {
        const data = window.sabotageData;
        delete window.sabotageData;
        script.remove();
        if (data?.geometry && data?.color) {
          resolve(data);
        } else {
          reject(new Error("sabotage のデータを読み込めませんでした。"));
        }
      };
      script.onerror = () => {
        script.remove();
        reject(new Error("sabotage のデータを読み込めませんでした。"));
      };
      document.head.appendChild(script);
    });
  }

  function preloadAnimation(priority = "low") {
    if (animationLoad || !firstColor || typeof VideoDecoder === "undefined") return;

    setAnimationLoading(true);
    animationLoad = loadAnimationData(priority).then(initialize, error => {
      animationLoad = undefined;
      setAnimationLoading(false);
      setTouchActive(false);
      console.error(error);
    }).catch(fail);
  }

  function setAnimationLoading(loading) {
    isLoadingAnimation = loading;
    updateLoadingStatus();
  }

  function updateLoadingStatus() {
    loadingStatus.hidden = !isLoadingAnimation || !(isHovered || isTouchActive);
  }

  function scheduleAnimationPreload() {
    if (window.requestIdleCallback) {
      window.requestIdleCallback(() => preloadAnimation());
    } else {
      window.setTimeout(() => preloadAnimation(), 0);
    }
  }

  showFirstFrame();
  if (document.readyState === "complete") {
    scheduleAnimationPreload();
  } else {
    window.addEventListener("load", scheduleAnimationPreload, {once: true});
  }
})();
