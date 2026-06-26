"""Local static server for Smart Checklist.

Identical to `python -m http.server` but sends no-cache headers, so the
browser always loads the latest HTML/JS/CSS instead of a stale cached copy.
Usage: python serve.py [port]   (default 8000)
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
        print(f"Serving Smart Checklist at http://localhost:{PORT}/")
        print("To STOP, close this window.")
        httpd.serve_forever()
