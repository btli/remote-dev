// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, fork } from "child_process";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("voice FIFO", () => {
  const testFifo = join(tmpdir(), "rdv-voice-test-fifo.fifo");

  afterEach(() => {
    try { unlinkSync(testFifo); } catch { /* May not exist */ }
  });

  it("creates a FIFO that can pass PCM data", async () => {
    // Create FIFO
    try { unlinkSync(testFifo); } catch { /* ok */ }
    execFileSync("mkfifo", ["-m", "0600", testFifo]);
    expect(existsSync(testFifo)).toBe(true);

    // Generate test PCM data: 10ms of 16kHz/16bit audio (320 bytes)
    const testData = Buffer.alloc(320);
    for (let i = 0; i < 160; i++) {
      testData.writeInt16LE(Math.floor(Math.sin(i / 10) * 16000), i * 2);
    }

    // Write test data to a temp file so the child scripts can read it
    const testDataPath = join(tmpdir(), "rdv-voice-test-data.bin");
    writeFileSync(testDataPath, testData);

    // FIFO openSync blocks the event loop until both ends are open.
    // We must use child processes so reader and writer run in parallel.
    const readerScript = join(tmpdir(), "rdv-voice-test-reader.mjs");
    const writerScript = join(tmpdir(), "rdv-voice-test-writer.mjs");

    writeFileSync(readerScript, `
      import { openSync, readSync, closeSync, constants } from "fs";
      const fifo = process.argv[2];
      const fd = openSync(fifo, constants.O_RDONLY);
      const buf = Buffer.alloc(320);
      const bytesRead = readSync(fd, buf, 0, 320, null);
      closeSync(fd);
      // Send result to parent as hex
      process.send({ bytesRead, hex: buf.subarray(0, bytesRead).toString("hex") });
    `);

    writeFileSync(writerScript, `
      import { openSync, readFileSync, writeSync, closeSync, constants } from "fs";
      const fifo = process.argv[2];
      const dataPath = process.argv[3];
      const data = readFileSync(dataPath);
      const fd = openSync(fifo, constants.O_WRONLY);
      writeSync(fd, data);
      closeSync(fd);
      process.send({ written: data.length });
    `);

    const result = await new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("FIFO test timed out after 5 seconds"));
      }, 5000);

      // Start reader first (it will block on openSync until writer opens)
      const reader = fork(readerScript, [testFifo], { execArgv: [] });

      // Start writer shortly after (its openSync unblocks the reader)
      const writer = fork(writerScript, [testFifo, testDataPath], { execArgv: [] });

      reader.on("message", (msg: { bytesRead: number; hex: string }) => {
        clearTimeout(timeout);
        resolve(Buffer.from(msg.hex, "hex"));
      });

      reader.on("error", (err) => { clearTimeout(timeout); reject(err); });
      writer.on("error", (err) => { clearTimeout(timeout); reject(err); });
      reader.on("exit", (code) => {
        if (code !== 0) { clearTimeout(timeout); reject(new Error(`Reader exited with code ${code}`)); }
      });
      writer.on("exit", (code) => {
        if (code !== 0) { clearTimeout(timeout); reject(new Error(`Writer exited with code ${code}`)); }
      });
    });

    expect(result.length).toBe(320);
    expect(result.equals(testData)).toBe(true);

    // Cleanup temp files
    try { unlinkSync(testDataPath); } catch { /* ok */ }
    try { unlinkSync(readerScript); } catch { /* ok */ }
    try { unlinkSync(writerScript); } catch { /* ok */ }
  });
});
