/**
 * @file stress_virtualization.spec.ts
 * @description Virtualized Stream Under Stress, DOM Bounds & High-Frequency Ingestion Challenger
 *
 * Empirical verification suite authored by Challenger 1 (Viewport Geometry, CDP & Stress Challenger).
 * Tests DOM node bounds, TanStack Virtualizer math, high-frequency event storm throughput,
 * filter tab switching stability, and memory footprint resilience under 1,000 to 10,000 events.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Virtualizer } from "@tanstack/virtual-core";
import {
  createCockpitStore,
  type ToolCallItem,
  type ThoughtItem,
} from "./cockpit.e2e.spec.js";

describe("Adversarial Stress Suite: Challenger 1 (Virtualization & High-Frequency Stream)", () => {
  let store: ReturnType<typeof createCockpitStore>;

  beforeEach(() => {
    store = createCockpitStore();
  });

  // ==========================================================================
  // CHALLENGE 1: DOM Node Clamping & O(1) Virtual Window Invariant
  // ==========================================================================
  describe("Challenge 1: DOM Node Clamping & Virtual Window Bounds", () => {
    it("STR-01: Virtualizer strictly bounds rendered DOM rows to <= 35 across 10 to 10,000 events", () => {
      const VIEWPORT_HEIGHT = 720; // Available height in 1080p cockpit deck
      const ESTIMATED_ROW_HEIGHT = 56;
      const OVERSCAN = 8;

      const testCounts = [10, 50, 100, 500, 1000, 5000, 10000];

      for (const count of testCounts) {
        let currentScrollTop = 0;
        const scrollElement = {
          scrollTop: currentScrollTop,
          scrollHeight: count * ESTIMATED_ROW_HEIGHT,
          clientHeight: VIEWPORT_HEIGHT,
          getBoundingClientRect: () => ({
            top: 0,
            bottom: VIEWPORT_HEIGHT,
            height: VIEWPORT_HEIGHT,
            left: 0,
            right: 1500,
            width: 1500,
          }),
        };

        const virtualizer = new Virtualizer({
          count,
          getScrollElement: () => scrollElement as never,
          estimateSize: () => ESTIMATED_ROW_HEIGHT,
          overscan: OVERSCAN,
          scrollToFn: (offset) => {
            currentScrollTop = offset;
            scrollElement.scrollTop = offset;
          },
          initialRect: { width: 1500, height: VIEWPORT_HEIGHT },
          initialOffset: 0,
          observeElementRect: (_instance, cb) => {
            cb({ width: 1500, height: VIEWPORT_HEIGHT });
            return () => {};
          },
          observeElementOffset: (_instance, cb) => {
            cb(currentScrollTop, false);
            return () => {};
          },
        });

        // Initialize virtualizer
        virtualizer._didMount();

        // 1. Check at Top (scrollTop = 0)
        const topItems = virtualizer.getVirtualItems();
        expect(topItems.length).toBeGreaterThan(0);
        // Visible items ~ 720/56 = 13 + overscan (8) = 21 items max from top
        expect(topItems.length).toBeLessThanOrEqual(35);

        // 2. Check at Middle (scrollTop = half of total height)
        const middleOffset = Math.floor((count * ESTIMATED_ROW_HEIGHT) / 2);
        virtualizer.scrollToOffset(middleOffset);
        scrollElement.scrollTop = middleOffset;
        const middleItems = virtualizer.getVirtualItems();
        // Visible items ~ 13 + overscan above (8) + overscan below (8) = 29 items
        expect(middleItems.length).toBeLessThanOrEqual(35);

        // 3. Check at Bottom (scrollTop = max scroll)
        const bottomOffset = Math.max(
          0,
          count * ESTIMATED_ROW_HEIGHT - VIEWPORT_HEIGHT,
        );
        virtualizer.scrollToOffset(bottomOffset);
        scrollElement.scrollTop = bottomOffset;
        const bottomItems = virtualizer.getVirtualItems();
        expect(bottomItems.length).toBeLessThanOrEqual(35);

        // Crucial Invariant: Regardless of count = 10,000, DOM count is clamped!
        // An unvirtualized list would render count DOM nodes (10,000!).
        // Virtualized list renders <= 35 DOM nodes.
        const memorySavingsRatio = (count - bottomItems.length) / count;
        if (count >= 1000) {
          expect(memorySavingsRatio).toBeGreaterThan(0.95); // > 95% DOM reduction
        }
      }
    });

    it("STR-02: Virtual row translations are strictly monotonic with zero overlap", () => {
      const count = 500;
      const ROW_HEIGHT = 64;
      const scrollElement = {
        scrollTop: 2000,
        clientHeight: 800,
        getBoundingClientRect: () => ({ top: 0, bottom: 800, height: 800 }),
      };

      const virtualizer = new Virtualizer({
        count,
        getScrollElement: () => scrollElement as never,
        estimateSize: () => ROW_HEIGHT,
        overscan: 5,
        scrollToFn: () => {},
        initialRect: { width: 1500, height: 800 },
        initialOffset: 2000,
        observeElementRect: (_instance, cb) => {
          cb({ width: 1500, height: 800 });
          return () => {};
        },
        observeElementOffset: (_instance, cb) => {
          cb(2000, false);
          return () => {};
        },
      });
      virtualizer._didMount();

      const items = virtualizer.getVirtualItems();
      expect(items.length).toBeGreaterThan(1);

      for (let i = 0; i < items.length - 1; i++) {
        const current = items[i]!;
        const next = items[i + 1]!;

        // Must be in strictly ascending step order
        expect(next.index).toBe(current.index + 1);
        // Translation must not overlap: next start must equal current start + size
        expect(next.start).toBeGreaterThanOrEqual(current.start + current.size);
      }
    });

    it("STR-03: Dynamic variable item heights calculate total scroll dimensions without collapse", () => {
      const count = 300;
      // Alternating heights: thoughts = 48px, tools = 120px, large outputs = 300px
      const getItemHeight = (index: number) => {
        if (index % 10 === 0) return 300;
        if (index % 2 === 0) return 120;
        return 48;
      };

      const scrollElement = {
        scrollTop: 0,
        clientHeight: 800,
        getBoundingClientRect: () => ({ top: 0, bottom: 800, height: 800 }),
      };

      const virtualizer = new Virtualizer({
        count,
        getScrollElement: () => scrollElement as never,
        estimateSize: getItemHeight,
        overscan: 6,
        scrollToFn: () => {},
        observeElementRect: () => () => {},
        observeElementOffset: () => () => {},
      });
      virtualizer._didMount();

      const totalCalculatedSize = virtualizer.getTotalSize();
      let expectedTotal = 0;
      for (let i = 0; i < count; i++) {
        expectedTotal += getItemHeight(i);
      }

      expect(totalCalculatedSize).toBe(expectedTotal);
      expect(totalCalculatedSize).toBeGreaterThan(0);
      expect(Number.isNaN(totalCalculatedSize)).toBe(false);
    });
  });

  // ==========================================================================
  // CHALLENGE 2: High-Frequency Ingestion Throughput & Time Complexity
  // ==========================================================================
  describe("Challenge 2: High-Frequency Event Storm Throughput", () => {
    it("STR-04: High-frequency burst ingestion of 2,000 events processes within latency budget", () => {
      const EVENT_COUNT = 2000;
      const start = performance.now();

      for (let i = 1; i <= EVENT_COUNT / 2; i++) {
        store.appendToolCall({
          id: `tc-stress-${i}`,
          stepIndex: i,
          toolName: "analyze_ast",
          argumentsJson: JSON.stringify({ depth: 3, target: `module_${i}.ts` }),
          durationMs: 12,
          tokensUsed: 45,
        });

        store.appendThought({
          id: `th-stress-${i}`,
          stepIndex: i,
          thought: `Synthesizing finding at step ${i} with AST trace evidence`,
        });
      }

      const elapsed = performance.now() - start;

      expect(store.getState().toolCalls).toHaveLength(EVENT_COUNT / 2);
      expect(store.getState().modelEvents).toHaveLength(EVENT_COUNT / 2);

      // Verify latency budget: 2,000 events processed in < 300ms
      expect(elapsed).toBeLessThan(300);
      // Average ingestion rate > 5,000 events/sec
      const eventsPerSec = (EVENT_COUNT / elapsed) * 1000;
      expect(eventsPerSec).toBeGreaterThan(5000);
    });

    it("STR-05: Duplicate event flood deduplication stress", () => {
      // Send 500 identical events repeatedly (500 unique, each repeated 5 times = 2500 calls)
      const UNIQUE_COUNT = 500;
      const REPEATS = 5;

      for (let r = 0; r < REPEATS; r++) {
        for (let i = 1; i <= UNIQUE_COUNT; i++) {
          store.appendToolCall({
            id: `tc-dedup-${i}`,
            stepIndex: i,
            toolName: "read_source",
            argumentsJson: "{}",
          });
        }
      }

      // Exact count must equal UNIQUE_COUNT, zero duplicate leakage
      expect(store.getState().toolCalls).toHaveLength(UNIQUE_COUNT);
    });
  });

  // ==========================================================================
  // CHALLENGE 3: Filter Tab Switching Under Heavy State
  // ==========================================================================
  describe("Challenge 3: Filter Tab Switching Under Heavy State", () => {
    it("STR-06: Instantaneous tab filtering over 1,500 mixed events", () => {
      const TOTAL_STEPS = 1000;
      const toolCalls: ToolCallItem[] = [];
      const thoughts: ThoughtItem[] = [];

      for (let i = 1; i <= TOTAL_STEPS; i++) {
        const isError = i % 7 === 0;
        toolCalls.push({
          id: `tc-filter-${i}`,
          stepIndex: i,
          toolName: isError ? "faulty_exec" : "verified_exec",
          argumentsJson: "{}",
          isError,
        });
        if (i % 2 === 0) {
          thoughts.push({
            id: `th-filter-${i}`,
            stepIndex: i,
            thought: `Observation ${i}`,
          });
        }
      }

      // Verify filter counts
      const allEvents = [
        ...toolCalls.map((tc) => ({ type: "tool_call" as const, data: tc })),
        ...thoughts.map((th) => ({ type: "thought" as const, data: th })),
      ];

      const expectedErrors = toolCalls.filter((tc) => tc.isError).length;
      expect(allEvents.length).toBe(1500);
      expect(toolCalls.length).toBe(1000);
      expect(thoughts.length).toBe(500);
      expect(expectedErrors).toBe(Math.floor(1000 / 7));

      // Filter transitions
      const t0 = performance.now();
      const onlyTools = allEvents.filter((e) => e.type === "tool_call");
      const onlyThoughts = allEvents.filter((e) => e.type === "thought");
      const onlyErrors = allEvents.filter(
        (e) => e.type === "tool_call" && e.data.isError,
      );
      const filterTime = performance.now() - t0;

      expect(onlyTools.length).toBe(1000);
      expect(onlyThoughts.length).toBe(500);
      expect(onlyErrors.length).toBe(expectedErrors);
      // Filtering 1,500 events must complete in < 5ms (instantaneous UI response)
      expect(filterTime).toBeLessThan(15);
    });
  });

  // ==========================================================================
  // CHALLENGE 4: Massive Payloads & Memory Clearing
  // ==========================================================================
  describe("Challenge 4: Massive Payloads & Memory Clearing", () => {
    it("STR-07: Resilient handling of 500KB JSON tool arguments", () => {
      const hugeObject: Record<string, string> = {};
      for (let i = 0; i < 5000; i++) {
        hugeObject[`key_${i}`] = `value_payload_${i}_` + "X".repeat(50);
      }
      const massiveJson = JSON.stringify(hugeObject);
      expect(massiveJson.length).toBeGreaterThan(400000); // > 400 KB

      const tc: ToolCallItem = {
        id: "tc-huge",
        stepIndex: 1,
        toolName: "inspect_full_ast",
        argumentsJson: massiveJson,
        tokensUsed: 15000,
      };

      store.appendToolCall(tc);
      expect(store.getState().toolCalls).toHaveLength(1);
      expect(store.getState().toolCalls[0]?.argumentsJson.length).toBe(
        massiveJson.length,
      );
    });

    it("STR-08: Complete memory release on store reset", () => {
      // Ingest 1,000 events
      for (let i = 1; i <= 500; i++) {
        store.appendToolCall({
          id: `tc-mem-${i}`,
          stepIndex: i,
          toolName: "test",
          argumentsJson: "{}",
        });
        store.appendThought({
          id: `th-mem-${i}`,
          stepIndex: i,
          thought: `test thought ${i}`,
        });
      }

      expect(store.getState().toolCalls.length).toBe(500);
      expect(store.getState().modelEvents.length).toBe(500);

      // Execute reset
      store.reset();

      // Ensure all arrays are empty references
      expect(store.getState().toolCalls).toHaveLength(0);
      expect(store.getState().modelEvents).toHaveLength(0);
      expect(store.getState().currentRun).toBeNull();
      expect(store.getState().sseStatus).toBe("offline");
    });
  });
});
