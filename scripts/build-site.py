#!/usr/bin/env python3
"""Assemble the GitHub Pages site into _site/: docs/site as-is, PRIVACY.md rendered to privacy.html,
and the store art copied in. Run from the repository root; needs `pip install markdown`."""
import pathlib, shutil, markdown
root = pathlib.Path(__file__).resolve().parent.parent
out = root / "_site"
if out.exists(): shutil.rmtree(out)
shutil.copytree(root / "docs/site", out)
(out / "shots").mkdir()
for n in ("01-office", "06-goal", "03-dressing-room"):
    shutil.copy(root / f"docs/store/{n}.png", out / "shots" / f"{n}.png")
shutil.copy(root / "docs/store/feature-graphic.png", out / "feature-graphic.png")
body = markdown.markdown((root / "PRIVACY.md").read_text(encoding="utf-8"), extensions=["tables"])
(out / "privacy.html").write_text(f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>개인정보처리방침 — 가난한자의 FM</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;600&family=Barlow+Condensed:wght@600;700&display=swap">
<link rel="stylesheet" href="site.css"></head>
<body><main class="doc"><p class="back"><a href="./">← 가난한자의 FM</a></p>{body}</main></body></html>
""", encoding="utf-8")
print("site →", out)
