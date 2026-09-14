#!/usr/bin/env python3
"""
CDP UI Verification & Screenshot Engine for Audit Harness.
"""

import os
import sys
import json
import base64
import argparse
import urllib.request
import asyncio
from typing import Optional, Dict, Any, List

try:
    import websockets
except ImportError:
    print("Error: websockets required", file=sys.stderr)
    sys.exit(1)


class CDPClient:
    def __init__(self, cdp_port: int = 9222):
        self.cdp_port = cdp_port
        self.ws = None
        self._req_id = 0

    def discover_tab_ws_url(self, target_substring: str = "5173") -> Optional[str]:
        api_url = f"http://127.0.0.1:{self.cdp_port}/json/list"
        with urllib.request.urlopen(api_url, timeout=5) as resp:
            tabs: List[Dict[str, Any]] = json.loads(resp.read().decode("utf-8"))
        for tab in tabs:
            if target_substring in tab.get("url", "") and tab.get("type") == "page":
                return tab.get("webSocketDebuggerUrl")
        for tab in tabs:
            if tab.get("type") == "page":
                return tab.get("webSocketDebuggerUrl")
        return None

    async def connect(self, ws_url: str):
        self.ws = await websockets.connect(ws_url, max_size=50 * 1024 * 1024)
        await self.send("Page.enable")
        await self.send("Runtime.enable")
        await self.send("DOM.enable")

    async def close(self):
        if self.ws:
            await self.ws.close()

    async def send(self, method: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        self._req_id += 1
        current_id = self._req_id
        payload = {"id": current_id, "method": method, "params": params or {}}
        await self.ws.send(json.dumps(payload))
        while True:
            raw_msg = await self.ws.recv()
            data = json.loads(raw_msg)
            if data.get("id") == current_id:
                if "error" in data:
                    raise RuntimeError(f"CDP Error ({method}): {data['error']}")
                return data.get("result", {})

    async def navigate(self, url: str, wait_seconds: float = 1.5):
        await self.send("Page.navigate", {"url": url})
        await asyncio.sleep(wait_seconds)

    async def eval_js(self, expression: str) -> Any:
        res = await self.send("Runtime.evaluate", {"expression": expression, "awaitPromise": True, "returnByValue": True})
        return res.get("result", {}).get("value")

    async def capture_screenshot(self, output_filepath: str) -> str:
        os.makedirs(os.path.dirname(os.path.abspath(output_filepath)), exist_ok=True)
        res = await self.send("Page.captureScreenshot", {"format": "png"})
        img_bytes = base64.b64decode(res.get("data", ""))
        with open(output_filepath, "wb") as f:
            f.write(img_bytes)
        print(f"[Captured] -> {output_filepath} ({len(img_bytes):,} bytes)")
        return output_filepath


async def run_scenario_suite(client: CDPClient, base_url: str, output_dir: str):
    print(f"Starting Scenario Suite against {base_url}...")
    
    # 1. Reset to Home Page
    await client.navigate(base_url, wait_seconds=2.0)
    await client.eval_js("""
        const logo = document.querySelector('header button');
        if (logo) logo.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    """)
    await asyncio.sleep(1.0)

    # 2. Scenario 1: Trigger Form Validation on Empty Inputs
    print("Testing Scenario 1: Form Validation Trigger...")
    await client.eval_js("""
        const inputs = document.querySelectorAll('form input[type="text"]');
        if (inputs.length >= 2) {
            inputs[0].value = '';
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
            inputs[1].value = '';
            inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
            const submitBtn = document.querySelector('form button[type="submit"]');
            if (submitBtn) submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
    """)
    await asyncio.sleep(1.0)
    await client.capture_screenshot(os.path.join(output_dir, "01-form-validation-and-presets.png"))

    # 3. Scenario 2: Load Test Preset & 2-Column Balanced View
    print("Testing Scenario 2: Load Test Preset...")
    await client.eval_js("""
        const buttons = Array.from(document.querySelectorAll('form button[type="button"]'));
        const preset = buttons.find(b => b.textContent.includes('Vault Reentrancy'));
        if (preset) preset.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    """)
    await asyncio.sleep(1.0)
    await client.capture_screenshot(os.path.join(output_dir, "02-high-density-configured.png"))

    # 4. Scenario 3: Navigate to Dashboard Analytics & Empty State
    print("Testing Scenario 3: Dashboard Analytics...")
    await client.eval_js("""
        const navBtns = Array.from(document.querySelectorAll('header nav button'));
        const dashBtn = navBtns.find(b => b.textContent.includes('Dashboard'));
        if (dashBtn) dashBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    """)
    await asyncio.sleep(2.0)
    await client.capture_screenshot(os.path.join(output_dir, "03-dashboard-analytics-empty-state.png"))

    # 5. Scenario 4: Navigate to Demo Mode & Replay Trajectory
    print("Testing Scenario 4: Demo Trajectory Player...")
    await client.eval_js("""
        const navBtns = Array.from(document.querySelectorAll('header nav button'));
        const demoBtn = navBtns.find(b => b.textContent.includes('Demo Mode'));
        if (demoBtn) demoBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    """)
    await asyncio.sleep(2.0)
    await client.eval_js("""
        const btns = Array.from(document.querySelectorAll('button'));
        const playBtn = btns.find(b => b.textContent.includes('Play'));
        if (playBtn) playBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    """)
    await asyncio.sleep(4.0)
    await client.capture_screenshot(os.path.join(output_dir, "04-demo-trajectory-replay.png"))

    print("\n[SUCCESS] All verification scenarios completed.")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9222)
    parser.add_argument("--url", type=str, default="http://127.0.0.1:5173")
    parser.add_argument(
        "--output-dir",
        type=str,
        default="/home/nguyen/.gemini/antigravity/brain/e672099d-2635-46ca-9ae1-f128ac6ddbaf/screenshots",
    )
    return parser.parse_args()


async def main_async():
    args = parse_args()
    client = CDPClient(cdp_port=args.port)
    ws_url = client.discover_tab_ws_url("5173")
    if not ws_url:
        print(f"Error: Unable to locate active browser tab on port {args.port}.", file=sys.stderr)
        sys.exit(1)
    await client.connect(ws_url)
    try:
        await run_scenario_suite(client, args.url, args.output_dir)
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main_async())
