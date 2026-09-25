#!/usr/bin/env python3
"""Push the store listing's images from docs/store to Play: the 512 icon, the 1024×500 feature
graphic and the phone screenshots (ko-KR), replacing what is there. Text stays as it is in the Console.

  PLAY_SERVICE_ACCOUNT_JSON=<json> python scripts/play-listing.py [shots...]

With no arguments the screenshots are the eight named in SHOTS below, in that order.
"""
import json, os, pathlib, sys, requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request

PKG = "dev.threesec.fm"
LANG = "ko-KR"
ROOT = pathlib.Path(__file__).resolve().parent.parent / "docs/store"
SHOTS = ["01-office", "02-tactics", "03-dressing-room", "05-lineups", "06-goal", "07-halftime", "08-results", "10-trophies"]

creds = service_account.Credentials.from_service_account_info(
    json.loads(os.environ["PLAY_SERVICE_ACCOUNT_JSON"]), scopes=["https://www.googleapis.com/auth/androidpublisher"])
creds.refresh(Request())
H = {"Authorization": f"Bearer {creds.token}"}
B = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PKG}"
U = f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PKG}"

def call(method, url, headers=None, **kw):
    r = requests.request(method, url, headers={**H, **(headers or {})}, timeout=120, **kw)
    if r.status_code >= 300:
        sys.exit(f"{method} {url} → {r.status_code}\n{r.text}")
    return r.json() if r.text else {}

def put_images(edit, kind, files):
    call("DELETE", f"{B}/edits/{edit}/listings/{LANG}/{kind}")
    for f in files:
        data = (ROOT / f"{f}.png").read_bytes()
        call("POST", f"{U}/edits/{edit}/listings/{LANG}/{kind}?uploadType=media", headers={"Content-Type": "image/png"}, data=data)
        print(f"  {kind}: {f}.png ({len(data) // 1024} KB)")

shots = sys.argv[1:] or SHOTS
for f in ["icon-512", "feature-graphic", *shots]:
    if not (ROOT / f"{f}.png").exists():
        sys.exit(f"missing docs/store/{f}.png")
edit = call("POST", f"{B}/edits")["id"]
put_images(edit, "icon", ["icon-512"])
put_images(edit, "featureGraphic", ["feature-graphic"])
put_images(edit, "phoneScreenshots", shots)
call("POST", f"{B}/edits/{edit}:commit")
print(f"listing images updated for {LANG}; edit {edit} committed")
