#!/usr/bin/env python3
"""Inject static HTML/CSS/JS into worker.js"""

with open("worker.js", "r", encoding="utf-8") as f:
    worker = f.read()

with open("index.html", "r", encoding="utf-8") as f:
    html = f.read()
with open("styles.css", "r", encoding="utf-8") as f:
    css = f.read()
with open("main.js", "r", encoding="utf-8") as f:
    js = f.read()

# Escape for template literal
def esc(s):
    return s.replace("\\", "\\\\").replace("`", "\\`")

html_esc = esc(html)
css_esc = esc(css)
js_esc = esc(js)

worker = worker.replace('const STATIC_HTML = `<!--HTML-->`;', f'const STATIC_HTML = `{html_esc}`;')
worker = worker.replace('const STATIC_CSS = `/*styles*/`;', f'const STATIC_CSS = `{css_esc}`;')
worker = worker.replace('const STATIC_JS = `/*js*/`;', f'const STATIC_JS = `{js_esc}`;')
worker = worker.replace("// JS will be injected at deploy time", "")

with open("worker.js", "w", encoding="utf-8") as f:
    f.write(worker)

print("Static files injected into worker.js")
