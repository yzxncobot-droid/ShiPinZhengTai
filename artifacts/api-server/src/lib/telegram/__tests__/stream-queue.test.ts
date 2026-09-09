/**
 * Tests for the stream concurrency limiter (stream-queue.ts).
 *
 * Covers the scenarios from the concurrency spec:
 *   TEST 1:  1 user streaming → 1/20 active
 *   TEST 2:  10 users streaming → 10/20 active
 *   TEST 3:  20 users streaming → 20/20 active
 *   TEST 4:  21st user → 20 active, 1 waiting
 *   TEST 5:  One stream finishes → 19 active, waiting request gets a slot
 *   TEST 6:  Client disconnect → slot released reliably
 *   TEST 7:  Telegram error → slot released, server doesn't crash
 *   TEST 8:  Queue timeout → request rejected, slot not consumed
 *   TEST 9:  FIFO order — no starvation
 *   TEST 10: Stats reflect real-time state
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a controllable stream task — a function that resolves only when
 * its `resolve()` is called externally. This lets us hold slots open to
 * test concurrency limits precisely.
 */
function createHoldableTask() {
  let resolveFn: () => void;
  const promise = new Promise<void>((r) => { resolveFn = r; });
  const fn = vi.fn(() => promise);
  return { fn, resolve: () => resolveFn(), promise };
}

/**
 * Create a holdable task that records its label in the executionOrder array
 * when it starts (before the slot-holding promise resolves).
 */
function createTrackedTask(label: string, order: string[]) {
  let resolveFn: () => void;
  const promise = new Promise<void>((r) => { resolveFn = r; });
  const fn = vi.fn(() => { order.push(label); return promise; });
  return { fn, resolve: () => resolveFn(), promise };
}

/** Import the module under test with fresh module state. */
async function importQueue() {
  vi.resetModules();
  return await import("../stream-queue");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  // Ensure the default concurrency is 20 regardless of container env.
  process.env.STREAM_MAX_CONCURRENCY = "20";
});

afterEach(() => {
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════════════
// CONCURRENCY TESTS
// ═══════════════════════════════════════════════════════════════════════════
describe("Stream concurrency limiter", () => {
  // ── TEST 1: 1 user streaming → 1/20 active ──────────────────────────────
  it("TEST 1: 1 stream → 1/20 active", async () => {
    const { enqueueStream, getStreamQueueStats } = await importQueue();
    const task = createHoldableTask();

    const p = enqueueStream(task.fn);
    // Let the microtask queue flush so the slot is acquired.
    await Promise.resolve();
    await Promise.resolve();

    const stats = getStreamQueueStats();
    expect(stats.active).toBe(1);
    expect(stats.maxConcurrency).toBe(20);
    expect(stats.waiting).toBe(0);

    task.resolve();
    await p;
    expect(getStreamQueueStats().active).toBe(0);
  });

  // ── TEST 2: 10 users streaming → 10/20 active ────────────────────────────
  it("TEST 2: 10 concurrent → 10/20 active", async () => {
    const { enqueueStream, getStreamQueueStats } = await importQueue();
    const tasks = Array.from({ length: 10 }, () => createHoldableTask());
    const promises = tasks.map((t) => enqueueStream(t.fn));

    await Promise.resolve();
    await Promise.resolve();

    const stats = getStreamQueueStats();
    expect(stats.active).toBe(10);
    expect(stats.waiting).toBe(0);

    tasks.forEach((t) => t.resolve());
    await Promise.all(promises);
    expect(getStreamQueueStats().active).toBe(0);
  });

  // ── TEST 3: 20 users streaming → 20/20 active ───────────────────────────
  it("TEST 3: 20 concurrent → 20/20 active", async () => {
    const { enqueueStream, getStreamQueueStats } = await importQueue();
    const tasks = Array.from({ length: 20 }, () => createHoldableTask());
    const promises = tasks.map((t) => enqueueStream(t.fn));

    await Promise.resolve();
    await Promise.resolve();

    const stats = getStreamQueueStats();
    expect(stats.active).toBe(20);
    expect(stats.waiting).toBe(0);

    tasks.forEach((t) => t.resolve());
    await Promise.all(promises);
    expect(getStreamQueueStats().active).toBe(0);
  });

  // ── TEST 4: 21st user → 20 active, 1 waiting ────────────────────────────
  it("TEST 4: 21st request → 20 active, 1 waiting", async () => {
    const { enqueueStream, getStreamQueueStats } = await importQueue();
    const tasks = Array.from({ length: 21 }, () => createHoldableTask());
    const promises = tasks.map((t) => enqueueStream(t.fn));

    await Promise.resolve();
    await Promise.resolve();

    const stats = getStreamQueueStats();
    expect(stats.active).toBe(20);
    expect(stats.waiting).toBe(1);

    // Release one slot → the waiting request should start.
    tasks[0].resolve();
    await promises[0];
    await Promise.resolve();
    await Promise.resolve();

    const stats2 = getStreamQueueStats();
    expect(stats2.active).toBe(20);
    expect(stats2.waiting).toBe(0);

    // Clean up remaining.
    tasks.slice(1).forEach((t) => t.resolve());
    await Promise.all(promises.slice(1));
  });

  // ── TEST 5: One stream finishes → waiting request gets a slot ───────────
  it("TEST 5: slot freed → waiting request acquires it (FIFO)", async () => {
    const { enqueueStream, getStreamQueueStats } = await importQueue();
    const tasks = Array.from({ length: 21 }, () => createHoldableTask());
    const promises = tasks.map((t) => enqueueStream(t.fn));

    await Promise.resolve();
    await Promise.resolve();
    expect(getStreamQueueStats()).toMatchObject({ active: 20, waiting: 1 });

    // Finish the first stream → the 21st should get a slot.
    tasks[0].resolve();
    await promises[0];
    await Promise.resolve();
    await Promise.resolve();

    expect(getStreamQueueStats()).toMatchObject({ active: 20, waiting: 0 });

    tasks.slice(1).forEach((t) => t.resolve());
    await Promise.all(promises.slice(1));
    expect(getStreamQueueStats().active).toBe(0);
  });

  // ── TEST 6: Client disconnect → slot released ───────────────────────────
  it("TEST 6: task throws (simulating disconnect) → slot released", async () => {
    const { enqueueStream, getStreamQueueStats } = await importQueue();

    const errorTask = () => Promise.reject(new Error("Client disconnected"));
    const holdTasks = Array.from({ length: 19 }, () => createHoldableTask());
    const holdPromises = holdTasks.map((t) => enqueueStream(t.fn));

    // Start 20 streams: 19 holding + 1 that errors.
    const errorPromise = enqueueStream(errorTask);
    // Prevent unhandled rejection during microtask flushing.
    errorPromise.catch(() => {});

    // Wait for the error task to complete and release its slot.
    await expect(errorPromise).rejects.toThrow("Client disconnected");
    await Promise.resolve();

    // The error task released its slot → 19 active (19 holds).
    expect(getStreamQueueStats().active).toBe(19);
    expect(getStreamQueueStats().totalFailed).toBe(1);

    // A new request should get a slot immediately (slot was freed).
    const newTask = createHoldableTask();
    const newPromise = enqueueStream(newTask.fn);
    await Promise.resolve();
    await Promise.resolve();
    expect(getStreamQueueStats().active).toBe(20);

    // Clean up.
    holdTasks.forEach((t) => t.resolve());
    newTask.resolve();
    await Promise.all([...holdPromises, newPromise]);
    expect(getStreamQueueStats().active).toBe(0);
  });

  // ── TEST 7: Telegram error → slot released, server doesn't crash ────────
  it("TEST 7: error during stream → slot released, no crash", async () => {
    const { enqueueStream, getStreamQueueStats } = await importQueue();

    const errorFn = () => Promise.reject(new Error("Telegram 429 Flood Wait"));
    const p = enqueueStream(errorFn);

    await expect(p).rejects.toThrow("Telegram 429 Flood Wait");

    const stats = getStreamQueueStats();
    expect(stats.active).toBe(0);
    expect(stats.totalFailed).toBe(1);
  });

  // ── TEST 8: Queue timeout → request rejected, slot not consumed ─────────
  it("TEST 8: queue timeout → request rejected, no slot consumed", async () => {
    vi.useFakeTimers();
    const { enqueueStream, getStreamQueueStats } = await importQueue();

    // Fill all 20 slots.
    const holdTasks = Array.from({ length: 20 }, () => createHoldableTask());
    const holdPromises = holdTasks.map((t) => enqueueStream(t.fn));

    // Need to flush microtasks with fake timers.
    await vi.advanceTimersByTimeAsync(0);

    expect(getStreamQueueStats()).toMatchObject({ active: 20, waiting: 0 });

    // 21st request goes to the waiting queue.
    const timeoutFn = vi.fn(() => Promise.resolve());
    const timeoutPromise = enqueueStream(timeoutFn);
    // Prevent unhandled rejection while we advance fake timers.
    timeoutPromise.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(getStreamQueueStats()).toMatchObject({ active: 20, waiting: 1 });

    // Advance past the queue timeout (30s default).
    await vi.advanceTimersByTimeAsync(31000);

    await expect(timeoutPromise).rejects.toThrow("Stream queue timeout");
    expect(getStreamQueueStats()).toMatchObject({
      active: 20,
      waiting: 0,
      totalTimedOut: 1,
    });
    // The timed-out request should NOT have started streaming.
    expect(timeoutFn).not.toHaveBeenCalled();

    // Clean up.
    vi.useRealTimers();
    holdTasks.forEach((t) => t.resolve());
    await Promise.all(holdPromises);
  });

  // ── TEST 9: FIFO order — no starvation ──────────────────────────────────
  it("TEST 9: waiting requests are dispatched in FIFO order", async () => {
    const { enqueueStream, getStreamQueueStats } = await importQueue();

    // Fill 20 slots with holdable tasks.
    const holdTasks = Array.from({ length: 20 }, () => createHoldableTask());
    const holdPromises = holdTasks.map((t) => enqueueStream(t.fn));
    await Promise.resolve();
    await Promise.resolve();
    expect(getStreamQueueStats().active).toBe(20);

    // Queue 3 more holdable+tracked requests (A, B, C).
    const executionOrder: string[] = [];
    const tA = createTrackedTask("A", executionOrder);
    const tB = createTrackedTask("B", executionOrder);
    const tC = createTrackedTask("C", executionOrder);

    const pA = enqueueStream(tA.fn);
    const pB = enqueueStream(tB.fn);
    const pC = enqueueStream(tC.fn);

    await Promise.resolve();
    await Promise.resolve();
    expect(getStreamQueueStats().waiting).toBe(3);
    expect(executionOrder).toEqual([]); // none started yet

    // Release one slot → A should start first (FIFO), B and C still waiting.
    holdTasks[0].resolve();
    await holdPromises[0];
    await Promise.resolve();
    await Promise.resolve();

    expect(executionOrder).toEqual(["A"]);
    expect(getStreamQueueStats()).toMatchObject({ active: 20, waiting: 2 });

    // Release A → B should start.
    tA.resolve();
    await pA;
    await Promise.resolve();
    await Promise.resolve();

    expect(executionOrder).toEqual(["A", "B"]);
    expect(getStreamQueueStats()).toMatchObject({ active: 20, waiting: 1 });

    // Release B → C should start.
    tB.resolve();
    await pB;
    await Promise.resolve();
    await Promise.resolve();

    expect(executionOrder).toEqual(["A", "B", "C"]);
    expect(getStreamQueueStats()).toMatchObject({ active: 20, waiting: 0 });

    // Clean up.
    tC.resolve();
    await pC;
    holdTasks.slice(1).forEach((t) => t.resolve());
    await Promise.all(holdPromises.slice(1));
    expect(getStreamQueueStats().active).toBe(0);
  });

  // ── TEST 10: Stats reflect real-time state ──────────────────────────────
  it("TEST 10: stats track active, waiting, processed, failed", async () => {
    const { enqueueStream, getStreamQueueStats } = await importQueue();

    // Run 3 successful + 1 failed stream sequentially.
    await enqueueStream(() => Promise.resolve());
    await enqueueStream(() => Promise.resolve());
    await enqueueStream(() => Promise.resolve());
    await expect(enqueueStream(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");

    const stats = getStreamQueueStats();
    expect(stats.active).toBe(0);
    expect(stats.waiting).toBe(0);
    expect(stats.totalProcessed).toBe(3);
    expect(stats.totalFailed).toBe(1);
    expect(stats.maxConcurrency).toBe(20);
  });

  // ── Slot is always released even if fn throws synchronously ─────────────
  it("releases slot when fn throws synchronously (not returning a promise)", async () => {
    const { enqueueStream, getStreamQueueStats } = await importQueue();

    // A function that throws synchronously (not returning a rejected promise).
    const syncThrow = () => { throw new Error("sync throw"); };

    await expect(enqueueStream(syncThrow as any)).rejects.toThrow("sync throw");

    const stats = getStreamQueueStats();
    expect(stats.active).toBe(0);
  });
});
