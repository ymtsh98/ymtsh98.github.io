#include <stddef.h>
#include <stdint.h>
#include <wasm_simd128.h>

enum {
  ExactLimit = 65536,
  HashSize = 2 * ExactLimit,
  BinCount = 1 + 17 * 32 * 32 * 32,
  PaletteLimit = 256
};

typedef struct {
  uint32_t key;
  double count;
  double channels[4];
} Entry;

typedef struct {
  uint32_t start;
  uint32_t size;
  double count;
  double score;
  uint32_t axis;
  uint32_t color;
} ColorBox;

static uint32_t hashSlots[HashSize];
static uint32_t exactColors[ExactLimit + 1];
static double exactCounts[ExactLimit + 1];
static uint32_t binKeys[BinCount];
static double bins[BinCount][5];
static uint32_t exactSize;
static uint32_t binSize;

static uint32_t getColorBin(uint32_t color) {
  uint32_t alpha = color >> 24;
  if (alpha == 0) {
    return 0;
  }
  uint32_t alphaBin = alpha == 255 ? 16 : alpha >> 4;
  return 1 + ((alphaBin << 15) | ((color >> 3 & 31) << 10)
    | ((color >> 11 & 31) << 5) | (color >> 19 & 31));
}

static void addToBin(uint32_t color, double count) {
  uint32_t key = getColorBin(color);
  double *bin = bins[key];
  if (bin[0] == 0) {
    binKeys[binSize++] = key;
  }
  bin[0] += count;
  for (uint32_t channel = 0; channel < 4; ++channel) {
    bin[channel + 1] += ((color >> (channel * 8)) & 255) * count;
  }
}

void resetHistogram(void) {
  for (uint32_t index = 0; index < HashSize; ++index) {
    hashSlots[index] = 0;
  }
  for (uint32_t index = 0; index < binSize; ++index) {
    double *bin = bins[binKeys[index]];
    for (uint32_t component = 0; component < 5; ++component) {
      bin[component] = 0;
    }
  }
  exactSize = 0;
  binSize = 0;
}

void collectPixels(const uint32_t *pixels, uint32_t length) {
  uint32_t index = 0;
  while (index < length) {
    uint32_t start = index;
    uint32_t color = pixels[index++];
    while (index < length && pixels[index] == color) {
      ++index;
    }
    double count = index - start;
    if (binSize != 0) {
      addToBin(color, count);
    } else {
      uint32_t hash = color ^ (color >> 16);
      hash *= 0x7feb352du;
      hash ^= hash >> 15;
      uint32_t slot = hash & (HashSize - 1);
      while (hashSlots[slot] != 0 && exactColors[hashSlots[slot] - 1] != color) {
        slot = (slot + 1) & (HashSize - 1);
      }
      if (hashSlots[slot] == 0) {
        hashSlots[slot] = exactSize + 1;
        exactColors[exactSize] = color;
        exactCounts[exactSize++] = count;
        if (exactSize > ExactLimit) {
          for (uint32_t entry = 0; entry < exactSize; ++entry) {
            addToBin(exactColors[entry], exactCounts[entry]);
          }
        }
      } else {
        exactCounts[hashSlots[slot] - 1] += count;
      }
    }
  }
}

int32_t getHistogramSize(void) {
  return binSize != 0 ? -(int32_t)binSize : (int32_t)exactSize;
}

uint32_t getPaletteWorkspaceSize(void) {
  uint32_t size = binSize != 0 ? binSize : exactSize;
  return (uint32_t)(sizeof(Entry) + 2 * sizeof(uint32_t)) * size;
}

static ColorBox makeColorBox(const Entry *entries, const uint32_t *order, uint32_t start, uint32_t size) {
  ColorBox box = { .start = start, .size = size, .score = -1 };
  double sums[4] = { 0 };
  double squares[4] = { 0 };
  for (uint32_t index = start; index < start + size; ++index) {
    const Entry *entry = &entries[order[index]];
    box.count += entry->count;
    for (uint32_t channel = 0; channel < 4; ++channel) {
      double value = entry->channels[channel];
      sums[channel] += value * entry->count;
      squares[channel] += value * value * entry->count;
    }
  }
  for (uint32_t channel = 0; channel < 4; ++channel) {
    double mean = sums[channel] / box.count;
    uint32_t rounded = (uint32_t)mean;
    rounded += mean - rounded >= 0.5;
    box.color |= rounded << (channel * 8);
    if (size > 1) {
      double weight = channel == 3 ? 4 : 1;
      double score = (squares[channel] - sums[channel] * mean) * weight;
      if (score > box.score) {
        box.axis = channel;
        box.score = score;
      }
    }
  }
  return box;
}

static void sortEntries(const Entry *entries, uint32_t *order, uint32_t *scratch,
  uint32_t size, uint32_t axis) {
  if (size < 2) {
    return;
  }
  uint32_t middle = size / 2;
  sortEntries(entries, order, scratch, middle, axis);
  sortEntries(entries, order + middle, scratch + middle, size - middle, axis);
  if (entries[order[middle - 1]].channels[axis] <= entries[order[middle]].channels[axis]) {
    return;
  }
  uint32_t left = 0;
  uint32_t right = middle;
  for (uint32_t index = 0; index < size; ++index) {
    if (right == size || (left < middle
      && entries[order[left]].channels[axis] <= entries[order[right]].channels[axis])) {
      scratch[index] = order[left++];
    } else {
      scratch[index] = order[right++];
    }
  }
  for (uint32_t index = 0; index < size; ++index) {
    order[index] = scratch[index];
  }
}

uint32_t buildPalette(uint32_t limit, uint32_t *colors, uint32_t *mapping, Entry *entries) {
  if (binSize == 0 && exactSize <= limit) {
    for (uint32_t index = 0; index < exactSize; ++index) {
      colors[index] = exactColors[index];
    }
    return exactSize;
  }
  uint32_t size = binSize != 0 ? binSize : exactSize;
  uint32_t *order = (uint32_t *)(entries + size);
  uint32_t *scratch = order + size;
  uint32_t groupSizes[3] = { 0 };
  for (uint32_t index = 0; index < size; ++index) {
    Entry *entry = &entries[index];
    if (binSize != 0) {
      uint32_t key = binKeys[index];
      entry->key = key;
      entry->count = bins[key][0];
      for (uint32_t channel = 0; channel < 4; ++channel) {
        entry->channels[channel] = bins[key][channel + 1] / entry->count;
      }
    } else {
      uint32_t color = exactColors[index];
      entry->key = color;
      entry->count = exactCounts[index];
      for (uint32_t channel = 0; channel < 4; ++channel) {
        entry->channels[channel] = (color >> (channel * 8)) & 255;
      }
    }
    double alpha = entry->channels[3];
    uint32_t group = alpha == 0 ? 0 : alpha == 255 ? 2 : 1;
    scratch[index] = group;
    ++groupSizes[group];
  }

  uint32_t starts[3] = { 0, groupSizes[0], groupSizes[0] + groupSizes[1] };
  uint32_t ends[3] = { starts[0], starts[1], starts[2] };
  for (uint32_t index = 0; index < size; ++index) {
    order[ends[scratch[index]]++] = index;
  }
  ColorBox boxes[PaletteLimit];
  uint32_t boxCount = 0;
  for (uint32_t group = 0; group < 3; ++group) {
    if (groupSizes[group] != 0) {
      boxes[boxCount++] = makeColorBox(entries, order, starts[group], groupSizes[group]);
    }
  }
  while (boxCount < limit) {
    int32_t split = -1;
    double bestScore = -1;
    for (uint32_t index = 0; index < boxCount; ++index) {
      if (boxes[index].score > bestScore) {
        split = (int32_t)index;
        bestScore = boxes[index].score;
      }
    }
    if (split < 0) {
      break;
    }
    ColorBox box = boxes[split];
    uint32_t *segment = order + box.start;
    sortEntries(entries, segment, scratch, box.size, box.axis);
    uint32_t cut = 1;
    double leftCount = entries[segment[0]].count;
    while (cut < box.size - 1 && leftCount < box.count / 2) {
      leftCount += entries[segment[cut++]].count;
    }
    boxes[split] = makeColorBox(entries, order, box.start, cut);
    boxes[boxCount++] = makeColorBox(entries, order, box.start + cut, box.size - cut);
  }
  uint32_t mapped = 0;
  for (uint32_t index = 0; index < boxCount; ++index) {
    const ColorBox *box = &boxes[index];
    colors[index] = box->color;
    for (uint32_t position = box->start; position < box->start + box->size; ++position) {
      mapping[mapped++] = entries[order[position]].key;
      mapping[mapped++] = box->color;
    }
  }
  return boxCount;
}

static int absValue(int value) {
  return value < 0 ? -value : value;
}

static int paethValue(int left, int up, int corner) {
  int leftDistance = absValue(up - corner);
  int upDistance = absValue(left - corner);
  int cornerDistance = absValue(left + up - 2 * corner);
  return leftDistance <= upDistance && leftDistance <= cornerDistance
    ? left : upDistance <= cornerDistance ? up : corner;
}

static v128_t paethLanes(v128_t left, v128_t up, v128_t corner) {
  v128_t deltaLeft = wasm_i16x8_sub(up, corner);
  v128_t deltaUp = wasm_i16x8_sub(left, corner);
  v128_t dl = wasm_i16x8_abs(deltaLeft);
  v128_t du = wasm_i16x8_abs(deltaUp);
  v128_t dc = wasm_i16x8_abs(wasm_i16x8_add(deltaLeft, deltaUp));
  v128_t useLeft = wasm_v128_and(wasm_i16x8_le(dl, du), wasm_i16x8_le(dl, dc));
  v128_t useUp = wasm_i16x8_le(du, dc);
  return wasm_v128_bitselect(left, wasm_v128_bitselect(up, corner, useUp), useLeft);
}

static v128_t paethBytes(v128_t left, v128_t up, v128_t corner) {
  v128_t low = paethLanes(wasm_u16x8_extend_low_u8x16(left), wasm_u16x8_extend_low_u8x16(up),
    wasm_u16x8_extend_low_u8x16(corner));
  v128_t high = paethLanes(wasm_u16x8_extend_high_u8x16(left), wasm_u16x8_extend_high_u8x16(up),
    wasm_u16x8_extend_high_u8x16(corner));
  return wasm_u8x16_narrow_i16x8(low, high);
}

static v128_t addCosts(v128_t sums, v128_t residuals) {
  v128_t magnitude = wasm_i8x16_abs(residuals);
  v128_t pair = wasm_u16x8_extadd_pairwise_u8x16(magnitude);
  return wasm_i32x4_add(sums, wasm_u32x4_extadd_pairwise_u16x8(pair));
}

static uint64_t sumCosts(v128_t sum) {
  return (uint64_t)wasm_u32x4_extract_lane(sum, 0) + wasm_u32x4_extract_lane(sum, 1)
    + wasm_u32x4_extract_lane(sum, 2) + wasm_u32x4_extract_lane(sum, 3);
}

static uint32_t selectFilter(const uint8_t *row, const uint8_t *above, uint32_t size, uint32_t stride) {
  v128_t none = wasm_i32x4_splat(0);
  v128_t sub = none;
  v128_t up = none;
  v128_t average = none;
  v128_t paeth = none;
  uint64_t scores[5] = { 0 };
  uint32_t index = 0;
  while (index < size) {
    if (index >= stride && size - index >= 16) {
      v128_t value = wasm_v128_load(row + index);
      v128_t left = wasm_v128_load(row + index - stride);
      v128_t top = above ? wasm_v128_load(above + index) : wasm_i32x4_splat(0);
      v128_t corner = above ? wasm_v128_load(above + index - stride) : wasm_i32x4_splat(0);
      none = addCosts(none, value);
      sub = addCosts(sub, wasm_i8x16_sub(value, left));
      up = addCosts(up, wasm_i8x16_sub(value, top));
      v128_t round = wasm_v128_and(wasm_v128_xor(left, top), wasm_i8x16_splat(1));
      v128_t mean = wasm_i8x16_sub(wasm_u8x16_avgr(left, top), round);
      average = addCosts(average, wasm_i8x16_sub(value, mean));
      paeth = addCosts(paeth, wasm_i8x16_sub(value, paethBytes(left, top, corner)));
      index += 16;
    } else {
      int value = row[index];
      int left = index < stride ? 0 : row[index - stride];
      int top = above ? above[index] : 0;
      int corner = above && index >= stride ? above[index - stride] : 0;
      scores[0] += absValue((int8_t)value);
      scores[1] += absValue((int8_t)(value - left));
      scores[2] += absValue((int8_t)(value - top));
      scores[3] += absValue((int8_t)(value - ((left + top) / 2)));
      scores[4] += absValue((int8_t)(value - paethValue(left, top, corner)));
      ++index;
    }
  }
  scores[0] += sumCosts(none);
  scores[1] += sumCosts(sub);
  scores[2] += sumCosts(up);
  scores[3] += sumCosts(average);
  scores[4] += sumCosts(paeth);
  uint32_t best = 0;
  for (uint32_t filter = 1; filter < 5; ++filter) {
    if (scores[filter] < scores[best]) {
      best = filter;
    }
  }
  return best;
}

uint32_t filterRows(const uint8_t *source, uint32_t rowSize, uint32_t height, uint32_t stride,
  uint8_t *adaptive, uint8_t *sub) {
  uint32_t allSub = 1;
  for (uint32_t y = 0; y < height; ++y) {
    const uint8_t *row = source + y * rowSize;
    const uint8_t *above = y == 0 ? NULL : row - rowSize;
    uint32_t filter = selectFilter(row, above, rowSize, stride);
    *adaptive++ = (uint8_t)filter;
    *sub++ = 1;
    allSub &= filter == 1;
    for (uint32_t index = 0; index < rowSize; ++index) {
      int value = row[index];
      int left = index < stride ? 0 : row[index - stride];
      int up = above ? above[index] : 0;
      int corner = above && index >= stride ? above[index - stride] : 0;
      sub[index] = (uint8_t)(value - left);
      int predict = 0;
      switch (filter) {
        case 1: predict = left; break;
        case 2: predict = up; break;
        case 3: predict = (left + up) / 2; break;
        case 4: predict = paethValue(left, up, corner); break;
      }
      adaptive[index] = (uint8_t)(value - predict);
    }
    adaptive += rowSize;
    sub += rowSize;
  }
  return allSub;
}
