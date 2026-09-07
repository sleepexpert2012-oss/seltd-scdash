"""Server tạm để nhận authorization code từ Shopee sau khi chủ shop đồng ý uỷ quyền.
Ghi toàn bộ query string ra file rồi hiển thị thông báo cho người dùng.
"""
import http.server, socketserver, urllib.parse, json, os, datetime

OUT = os.path.join(os.path.dirname(__file__), 'auth_code.json')
PORT = 8787

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        if q:
            q['_received_at'] = datetime.datetime.now().isoformat()
            q['_path'] = self.path
            with open(OUT, 'w') as f:
                json.dump(q, f, ensure_ascii=False, indent=1)
            print('GOT', json.dumps(q, ensure_ascii=False), flush=True)
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        ok = 'code' in q
        self.wfile.write((
            '<html><body style="font-family:system-ui;padding:40px">'
            f'<h2>{"Đã nhận uỷ quyền Shopee" if ok else "Chưa thấy code"}</h2>'
            f'<pre>{json.dumps(q, ensure_ascii=False, indent=1)}</pre>'
            '</body></html>').encode('utf-8'))

    def log_message(self, *a):
        pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', PORT), H) as s:
    print(f'listening on http://localhost:{PORT}/callback', flush=True)
    s.serve_forever()
