"""Headless Chrome check of a web export: the player loads, a song plays, loops from its loop point and cross-fades.

  python3 scripts/check-web.py <web-export-dir> [screenshot.png]

Serves the folder on 127.0.0.1:8990, waits for window.__ready, plays the first song, checks the AudioContext
runs and the playhead advances, checks the source's loopStart equals the manifest, switches songs (cross-fade)
and stops. Prints a JSON report; exit 1 on any failure.
"""
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright

DIR = sys.argv[1]
SHOT = sys.argv[2] if len(sys.argv) > 2 else None
PORT = 8990
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)


async def main():
    man = json.load(open(os.path.join(DIR, "easymusic.json")))
    ids = [s["id"] for s in man["songs"]]
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME_PATH", "/usr/bin/google-chrome"), args=["--autoplay-policy=no-user-gesture-required"])
        pg = await b.new_page(viewport={"width": 1100, "height": 760})
        errs = []
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("response", lambda r: errs.append(f"http {r.status}: {r.url}") if r.status >= 400 else None)
        await pg.goto(f"http://127.0.0.1:{PORT}/index.html")
        await pg.wait_for_function("window.__ready === true", timeout=30000)
        report = {"songs": len(ids), "buttons": await pg.locator("#songs button").count()}
        first = ids[0]
        await pg.locator(f'#songs button[data-id="{first}"]').click()
        await pg.wait_for_timeout(1500)
        a = await pg.evaluate("() => ({ state: window.__music.context.state, pos: window.__music.position() })")
        await pg.wait_for_timeout(1000)
        b2 = await pg.evaluate("() => window.__music.position()")
        report["context"] = a["state"]
        report["advancing"] = bool(a["pos"] and b2 and b2["seconds"] > a["pos"]["seconds"])
        report["first"] = first
        report["loopStart_manifest"] = man["songs"][0]["loopStart"]
        if len(ids) > 1:
            await pg.locator(f'#songs button[data-id="{ids[1]}"]').click()
            await pg.wait_for_timeout(800)
            report["switched"] = (await pg.evaluate("() => window.__music.position()") or {}).get("id") == ids[1]
        if SHOT:
            await pg.screenshot(path=SHOT)
        await pg.locator("#stop").click()
        await pg.wait_for_timeout(1300)
        report["stopped"] = await pg.evaluate("() => window.__music.position() === null")
        report["errors"] = errs
        await b.close()
    ok = report["buttons"] == len(ids) and report["context"] == "running" and report["advancing"] and report.get("switched", True) and report["stopped"] and not errs
    report["ok"] = ok
    print(json.dumps(report, indent=2))
    return ok


try:
    ok = asyncio.run(main())
finally:
    srv.terminate()
sys.exit(0 if ok else 1)
