// Owner: Reader (Ahana).
//
// Generates assets/reader/sample-plaintext.wav — a small, real, playable audio file so the
// AUDIO branch of the acquisition path (downloadBook / contentStore's "open access / audio:
// already plaintext" branch) has something real to seed and a resolver has something real to
// point a URI at. Same reasoning as generateSamplePdf.ts and generateSampleEpub.ts before it:
// there is no audio anywhere in this repo, and there must never be a real one (licensed content
// must not be committed), so a generated stand-in is what makes the AUDIO path reachable at all
// outside unit tests.
//
// Run: npm run reader:build-sample-audio
//
// WHY WAV AND NOT MP3/AAC: a real MP3/AAC encoder is either a native dependency (more moving
// parts than the ~1MB fixture it would produce) or a shelled-out platform tool (afconvert exists
// on macOS but not Linux/CI, which would make this script non-portable — every other generator in
// this directory is pure Node so it runs anywhere `npm run` does). PCM WAV needs no encoder at
// all: it is samples plus a 44-byte header, deterministically producible in a few lines, and
// every native audio API (AVAudioPlayer, ExoPlayer, RNTP) plays it natively with no codec at all
// — which is actually a BETTER property for a fixture whose whole job is proving the acquisition
// and URI-resolution path work, not exercising a codec. If a real compressed-format fixture is
// wanted later, swap this generator's output codec, not its shape.
//
// BYTE-REPRODUCIBLE, same discipline as generateSamplePdf.ts: every sample is a pure function of
// its index, no Date/Math.random involved. Unlike the PDF this is NOT wired into CI's freshness
// check (no `assets/reader/sample-plaintext.wav` row was added to CLAUDE.md's generated-artifact
// table) — that is a deliberate, separate decision for whoever wires this fixture into CI, not an
// oversight here.
//
// A CHANGING TONE OVER TIME, DELIBERATELY — same reasoning as generateSamplePdf.ts's "distinct
// text per page": a single unchanging tone for the whole duration would make a seek/scrub/offset
// bug (Phase 3's whole job) invisible, the same way identical PDF pages would hide a paging bug.
//
// This script uses Node globals. Legitimate here for the same reason as its siblings: it runs
// under Node, never on device.

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const OUTPUT = path.join(REPO_ROOT, 'assets', 'reader', 'sample-plaintext.wav');

const SAMPLE_RATE = 8000; // Hz — low but perfectly intelligible for tones, keeps the file small.
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const DURATION_SECONDS = 60;
const NOTE_DURATION_SECONDS = 0.5;

/** A short ascending arpeggio (C4-E4-G4-C5), repeated for the whole duration. */
const NOTE_FREQUENCIES_HZ = [261.63, 329.63, 392.0, 523.25];

/** Fraction of full scale, kept well under 1.0 to leave headroom and avoid clipping. */
const AMPLITUDE = 0.3;

/** Linear ramp at each note's start/end, so adjacent notes at different frequencies don't click
 * at the boundary — the sine for each note starts its own phase at 0, so without this the
 * waveform would jump discontinuously every NOTE_DURATION_SECONDS. */
const FADE_SECONDS = 0.01;

function buildPcmSamples(): Int16Array {
  const totalSamples = SAMPLE_RATE * DURATION_SECONDS;
  const noteSamples = Math.round(SAMPLE_RATE * NOTE_DURATION_SECONDS);
  const fadeSamples = Math.round(SAMPLE_RATE * FADE_SECONDS);
  const samples = new Int16Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const noteIndex = Math.floor(i / noteSamples) % NOTE_FREQUENCIES_HZ.length;
    const sampleInNote = i % noteSamples;
    const freq = NOTE_FREQUENCIES_HZ[noteIndex];

    const tInNote = sampleInNote / SAMPLE_RATE;
    let envelope = 1;
    if (sampleInNote < fadeSamples) {
      envelope = sampleInNote / fadeSamples;
    } else if (sampleInNote >= noteSamples - fadeSamples) {
      envelope = (noteSamples - sampleInNote) / fadeSamples;
    }

    const value = Math.sin(2 * Math.PI * freq * tInNote) * envelope * AMPLITUDE;
    samples[i] = Math.round(value * 32767);
  }

  return samples;
}

/** Standard 44-byte canonical WAV header (RIFF/WAVE/fmt /data), PCM, no extension chunk. */
function buildWavHeader(dataLength: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8;
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8;

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8, 'ascii');

  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM fmt subchunk size
  header.writeUInt16LE(1, 20); // audio format 1 = PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);

  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataLength, 40);

  return header;
}

function buildWav(): Buffer {
  const samples = buildPcmSamples();
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const header = buildWavHeader(data.length);
  return Buffer.concat([header, data]);
}

/**
 * Structural self-check, same spirit as generateSamplePdf.ts's assertStructure: a malformed
 * fixture should fail HERE, not as silence (or a native crash) on a device.
 */
function assertStructure(wav: Buffer): void {
  if (wav.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Output does not start with the RIFF magic bytes.');
  }
  if (wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Output has no WAVE marker at byte 8.');
  }
  if (wav.toString('ascii', 12, 16) !== 'fmt ') {
    throw new Error('Output has no fmt  subchunk at byte 12.');
  }
  if (wav.toString('ascii', 36, 40) !== 'data') {
    throw new Error('Output has no data subchunk at byte 36 — this generator only emits the ' +
      'canonical 44-byte header with no extension chunk, so the data subchunk must start exactly there.');
  }

  const declaredChunkSize = wav.readUInt32LE(4);
  if (declaredChunkSize !== wav.length - 8) {
    throw new Error(`RIFF chunk size ${declaredChunkSize} does not match file length ${wav.length} - 8.`);
  }

  const audioFormat = wav.readUInt16LE(20);
  if (audioFormat !== 1) {
    throw new Error(`Expected PCM (audio format 1), got ${audioFormat}.`);
  }
  const numChannels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  const bitsPerSample = wav.readUInt16LE(34);
  if (numChannels !== CHANNELS || sampleRate !== SAMPLE_RATE || bitsPerSample !== BITS_PER_SAMPLE) {
    throw new Error(
      `fmt subchunk mismatch: channels=${numChannels}, sampleRate=${sampleRate}, bits=${bitsPerSample}`,
    );
  }

  const declaredDataLength = wav.readUInt32LE(40);
  const actualDataLength = wav.length - 44;
  if (declaredDataLength !== actualDataLength) {
    throw new Error(`data subchunk declares ${declaredDataLength} bytes, file has ${actualDataLength}.`);
  }

  const expectedDurationSeconds = actualDataLength / (sampleRate * numChannels * (bitsPerSample / 8));
  if (Math.abs(expectedDurationSeconds - DURATION_SECONDS) > 0.001) {
    throw new Error(`Expected ${DURATION_SECONDS}s of audio, header/data implies ${expectedDurationSeconds}s.`);
  }
}

async function main(): Promise<void> {
  const wav = buildWav();

  assertStructure(wav);

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, wav);

  console.log(
    `Wrote ${path.relative(REPO_ROOT, OUTPUT)} ` +
      `(${wav.length} bytes, ${DURATION_SECONDS}s, ${SAMPLE_RATE}Hz mono PCM)`,
  );
}

void main();
