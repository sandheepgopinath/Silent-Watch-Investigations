---
description: How to start the local development server without caching issues
---

To start the local server with caching disabled (ensures you see your latest changes):

1. Open a terminal in the project root.
2. Run the start script:
   // turbo
   ./start_dev.sh

DO NOT use `python3 -m http.server` directly, as it enables browser caching which can hide your changes.
