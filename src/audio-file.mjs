import { readFileSync } from "node:fs";

// Duration of a WAV, AIFF, or FLAC file from its header. Used to tell an agent
// how long Raw playback would be. The file is never inserted into Bitwig here.
export function readAudioFileTiming(filePath) {
  if (typeof filePath !== "string" || filePath.charAt(0) !== "/") {
    throw new Error("Audio path must be an absolute WAV, AIFF, or FLAC file.");
  }
  let buffer;
  try {
    buffer = readFileSync(filePath);
  } catch (error) {
    throw new Error("Could not read audio file ‘" + filePath + "’: " + error.message);
  }
  const described = describeAudioBuffer(buffer);
  return { path: filePath, ...described };
}

export function describeAudioBuffer(buffer) {
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE") {
    return describeWav(buffer);
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "FORM") {
    const form = buffer.toString("ascii", 8, 12);
    if (form === "AIFF" || form === "AIFC") return describeAiff(buffer);
  }
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "fLaC") return describeFlac(buffer);
  throw new Error("Audio file must be WAV, AIFF, or FLAC.");
}

function describeWav(buffer) {
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitDepth = 0;
  let blockAlign = 0;
  let dataBytes = 0;
  let frames = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt " && size >= 16 && start + 16 <= buffer.length) {
      channels = buffer.readUInt16LE(start + 2);
      sampleRate = buffer.readUInt32LE(start + 4);
      blockAlign = buffer.readUInt16LE(start + 12);
      bitDepth = buffer.readUInt16LE(start + 14);
    } else if (id === "data") {
      dataBytes = size;
    } else if (id === "fact" && size >= 4 && start + 4 <= buffer.length) {
      frames = buffer.readUInt32LE(start);
    }
    offset = start + size + (size % 2);
  }
  if (!(sampleRate > 0) || !(channels > 0)) throw new Error("WAV file is missing a sample rate.");
  if (!(frames > 0)) {
    if (!(blockAlign > 0)) blockAlign = channels * Math.ceil(bitDepth / 8);
    if (!(dataBytes > 0) || !(blockAlign > 0)) throw new Error("WAV file is missing sample data.");
    frames = Math.floor(dataBytes / blockAlign);
  }
  return timing("wav", sampleRate, channels, bitDepth, frames);
}

function describeAiff(buffer) {
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitDepth = 0;
  let frames = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32BE(offset + 4);
    const start = offset + 8;
    if (id === "COMM" && size >= 18 && start + 18 <= buffer.length) {
      channels = buffer.readInt16BE(start);
      frames = buffer.readUInt32BE(start + 2);
      bitDepth = buffer.readInt16BE(start + 6);
      sampleRate = readExtended80(buffer, start + 8);
    }
    offset = start + size + (size % 2);
  }
  if (!(sampleRate > 0) || !(frames > 0)) throw new Error("AIFF file is missing a COMM chunk.");
  return timing("aiff", sampleRate, channels, bitDepth, frames);
}

function describeFlac(buffer) {
  if (buffer.length < 42) throw new Error("FLAC file is missing its stream info.");
  const blockType = buffer[4] & 0x7f;
  if (blockType !== 0) throw new Error("FLAC file does not start with stream info.");
  // STREAMINFO: 16+16+24+24 bits of block and frame sizes, then a packed field.
  let bit = (4 + 1 + 3 + 10) * 8;
  const sampleRate = readBits(buffer, bit, 20);
  bit += 20;
  const channels = readBits(buffer, bit, 3) + 1;
  bit += 3;
  const bitDepth = readBits(buffer, bit, 5) + 1;
  bit += 5;
  const frames = readBits(buffer, bit, 36);
  if (!(sampleRate > 0) || !(frames > 0)) throw new Error("FLAC stream info has no duration.");
  return timing("flac", sampleRate, channels, bitDepth, frames);
}

function timing(format, sampleRate, channels, bitDepth, frames) {
  return {
    format,
    sampleRate,
    channels,
    bitDepth,
    frames,
    durationSeconds: frames / sampleRate
  };
}

// 80-bit IEEE extended float, as stored in an AIFF COMM chunk.
function readExtended80(buffer, offset) {
  const exponent = ((buffer[offset] & 0x7f) << 8) | buffer[offset + 1];
  let mantissa = 0n;
  for (let i = 0; i < 8; i++) mantissa = (mantissa << 8n) | BigInt(buffer[offset + 2 + i]);
  if (exponent === 0 && mantissa === 0n) return 0;
  const value = Number(mantissa) * 2 ** (exponent - 16383 - 63);
  return buffer[offset] & 0x80 ? -value : value;
}

function readBits(buffer, bitOffset, count) {
  let value = 0;
  for (let i = 0; i < count; i++) {
    const at = bitOffset + i;
    const byte = buffer[Math.floor(at / 8)] || 0;
    const bit = (byte >> (7 - (at % 8))) & 1;
    value = value * 2 + bit;
  }
  return value;
}
