import test from "node:test";
import assert from "node:assert/strict";
import { describeAudioBuffer } from "../src/audio-file.mjs";
import { loadController } from "./support/load-controller.mjs";

function wav({ sampleRate = 48000, channels = 2, bitDepth = 24, frames = 48000 } = {}) {
  const blockAlign = channels * Math.ceil(bitDepth / 8);
  const dataBytes = frames * blockAlign;
  const buffer = Buffer.alloc(44 + 8);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

function extended80(sampleRate) {
  const out = Buffer.alloc(10);
  if (sampleRate === 0) return out;
  let exponent = 16383 + 63;
  let mantissa = BigInt(Math.round(sampleRate));
  while (mantissa > 0n && (mantissa >> 63n) === 0n) {
    mantissa <<= 1n;
    exponent -= 1;
  }
  out.writeUInt16BE(exponent, 0);
  let rest = mantissa;
  for (let i = 0; i < 8; i++) {
    out[2 + i] = Number((rest >> BigInt(56 - i * 8)) & 0xffn);
  }
  return out;
}

function aiff({ sampleRate = 48000, channels = 1, bitDepth = 16, frames = 96000 } = {}) {
  const comm = Buffer.alloc(18);
  comm.writeInt16BE(channels, 0);
  comm.writeUInt32BE(frames, 2);
  comm.writeInt16BE(bitDepth, 6);
  extended80(sampleRate).copy(comm, 8);
  const buffer = Buffer.alloc(12 + 8 + comm.length);
  buffer.write("FORM", 0);
  buffer.writeUInt32BE(buffer.length - 8, 4);
  buffer.write("AIFF", 8);
  buffer.write("COMM", 12);
  buffer.writeUInt32BE(comm.length, 16);
  comm.copy(buffer, 20);
  return buffer;
}

function flac({ sampleRate = 48000, channels = 2, bitDepth = 24, frames = 96000 } = {}) {
  const buffer = Buffer.alloc(42);
  buffer.write("fLaC", 0);
  buffer[4] = 0x80; // last metadata block, type 0 STREAMINFO
  buffer[5] = 0;
  buffer[6] = 0;
  buffer[7] = 34;
  // Skip 10 bytes of block/frame sizes. Packed field starts at byte 18.
  const field = Buffer.alloc(8);
  let bits = "";
  bits += sampleRate.toString(2).padStart(20, "0");
  bits += (channels - 1).toString(2).padStart(3, "0");
  bits += (bitDepth - 1).toString(2).padStart(5, "0");
  bits += frames.toString(2).padStart(36, "0");
  for (let i = 0; i < 64; i++) if (bits[i] === "1") field[Math.floor(i / 8)] |= 1 << (7 - (i % 8));
  field.copy(buffer, 18);
  return buffer;
}

test("a 48 kHz 24-bit stereo WAV reports its real duration", () => {
  const described = describeAudioBuffer(wav({ frames: 48000 }));
  assert.equal(described.format, "wav");
  assert.equal(described.sampleRate, 48000);
  assert.equal(described.bitDepth, 24);
  assert.equal(described.channels, 2);
  assert.equal(described.durationSeconds, 1);
});

test("an AIFF COMM chunk reports frame duration at the original rate", () => {
  const described = describeAudioBuffer(aiff({ frames: 96000 }));
  assert.equal(described.format, "aiff");
  assert.equal(described.sampleRate, 48000);
  assert.equal(described.durationSeconds, 2);
});

test("a FLAC stream info block reports duration without decoding audio", () => {
  const described = describeAudioBuffer(flac({ frames: 144000, channels: 1, bitDepth: 16 }));
  assert.equal(described.format, "flac");
  assert.equal(described.sampleRate, 48000);
  assert.equal(described.channels, 1);
  assert.equal(described.bitDepth, 16);
  assert.equal(described.durationSeconds, 3);
});

test("place_audio_file reports the Raw length and does not insert the file", () => {
  const loaded = loadController();
  const { context } = loaded;
  context.dispatch = loaded.originalDispatch;
  let inserted = false;
  context.transport = { tempo: () => ({ value: () => ({ getRaw: () => 80 }) }) };
  context.application = { createAudioTrack() { inserted = true; } };
  context.enqueue(5000, "1", "place_audio_file", {
    path: "/tmp/stem.wav",
    startBeats: 16,
    stretchMode: "raw",
    durationSeconds: 3,
    sampleRate: 48000,
    bitDepth: 24
  }, 10000);
  // The refusal is synchronous.
  const responses = loaded.responses;
  // Drive the queued request. enqueue calls processNextRequest, which schedules the watchdog
  // and dispatches immediately inside scheduleTask(watch) — dispatch itself is sync.
  assert.equal(responses.length, 1);
  assert.equal(responses[0].ok, false);
  assert.equal(responses[0].payload.placed, false);
  assert.equal(responses[0].payload.stretchModeApplied, false);
  assert.equal(responses[0].payload.projectTempo, 80);
  assert.equal(responses[0].payload.rawLengthBeats, 4);
  assert.match(responses[0].payload.message, /did not place the audio file/);
  assert.match(responses[0].payload.message, /4 beats/);
  assert.equal(inserted, false);
});

test("a file that is not WAV, AIFF, or FLAC is refused", () => {
  assert.throws(() => describeAudioBuffer(Buffer.from("not audio")), /WAV, AIFF, or FLAC/);
});
