#!/usr/bin/env python3
"""Assign an App Bundle that Play already has (by versionCode) to a track, without re-uploading.

  PLAY_SERVICE_ACCOUNT_JSON=<json> python scripts/play-promote.py <track> <versionCode> [status]

<track> is the track id: internal, alpha (the default closed track), beta, production, or the name of a
closed track you created. Prints the tracks the app has when the one you asked for does not exist.
"""
import json, os, sys, time, requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request

PKG = "dev.threesec.fm"
track, vc = sys.argv[1], int(sys.argv[2])
status = sys.argv[3] if len(sys.argv) > 3 else "completed"
creds = service_account.Credentials.from_service_account_info(
    json.loads(os.environ["PLAY_SERVICE_ACCOUNT_JSON"]), scopes=["https://www.googleapis.com/auth/androidpublisher"])
creds.refresh(Request())
H = {"Authorization": f"Bearer {creds.token}", "Content-Type": "application/json"}
B = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PKG}"

def call(method, url, **kw):
    r = requests.request(method, url, headers=H, timeout=60, **kw)
    if r.status_code >= 300:
        sys.exit(f"{method} {url} → {r.status_code}\n{r.text}")
    return r.json() if r.text else {}

edit = call("POST", f"{B}/edits")["id"]
E = f"{B}/edits/{edit}"
bundles = [b["versionCode"] for b in call("GET", f"{E}/bundles").get("bundles", [])]
if vc not in bundles:
    sys.exit(f"versionCode {vc} is not among the bundles Play has: {bundles}")
tracks = call("GET", f"{E}/tracks").get("tracks", [])
ids = [t["track"] for t in tracks]
if track not in ids:
    sys.exit(f"track '{track}' not found. This app's tracks: {ids}")
notes_path = "apps/viewer/android/whatsnew/whatsnew-ko-KR"
notes = open(notes_path, encoding="utf-8").read().strip() if os.path.exists(notes_path) else ""
release = {"versionCodes": [str(vc)], "status": status}
if notes:
    release["releaseNotes"] = [{"language": "ko-KR", "text": notes}]
call("PUT", f"{E}/tracks/{track}", data=json.dumps({"track": track, "releases": [release]}))
call("POST", f"{E}:commit")
print(f"assigned versionCode {vc} to track '{track}' ({status}); edit {edit} committed")
