"""Loopback-only desktop launcher and API bridge."""
import os, sys, json, secrets, threading, webbrowser, mimetypes, argparse
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import api
ROOT=Path(__file__).resolve().parent
KEY=secrets.token_urlsafe(32)
TOKEN=''
LOCK=threading.Lock()
DATA_DIR=Path(os.environ.get('LOCALAPPDATA',str(Path.home()/'.local/share')))
TOKEN_FILE=DATA_DIR/'RefitCanvas'/'token.bin'
# Read-only fallback for tokens saved by SDStudio Inpaint Desk 1.0/1.1 (the previous name).
LEGACY_TOKEN_FILE=DATA_DIR/'SDStudioInpaintDesk'/'token.bin'
# Last-used editor settings (no token, no images).
SETTINGS_FILE=DATA_DIR/'RefitCanvas'/'settings.json'

def protect(data,decode=False):
    if sys.platform!='win32': raise api.ApiError('토큰 저장은 Windows 사용자 암호화 기능이 있는 환경에서만 지원합니다.')
    import ctypes
    from ctypes import wintypes
    class Blob(ctypes.Structure): _fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_ubyte))]
    buf=ctypes.create_string_buffer(data);src=Blob(len(data),ctypes.cast(buf,ctypes.POINTER(ctypes.c_ubyte)));out=Blob()
    crypt=ctypes.windll.crypt32
    bp=ctypes.POINTER(Blob)
    crypt.CryptProtectData.argtypes=[bp,wintypes.LPCWSTR,bp,ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,bp]
    crypt.CryptProtectData.restype=wintypes.BOOL
    crypt.CryptUnprotectData.argtypes=[bp,ctypes.c_void_p,bp,ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,bp]
    crypt.CryptUnprotectData.restype=wintypes.BOOL
    if decode: ok=crypt.CryptUnprotectData(ctypes.byref(src),None,None,None,None,1,ctypes.byref(out))
    else: ok=crypt.CryptProtectData(ctypes.byref(src),'Refit Canvas',None,None,None,1,ctypes.byref(out))
    if not ok: raise api.ApiError('Windows 토큰 암호화에 실패했습니다.')
    try:return ctypes.string_at(out.data,out.size)
    finally:
        ctypes.windll.kernel32.LocalFree.argtypes=[ctypes.c_void_p]
        ctypes.windll.kernel32.LocalFree(out.data)

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def send(self,data,status=200,mime='application/json',extra_headers=None):
        if not isinstance(data,bytes): data=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(data)))
        
        for k,v in (extra_headers or {}).items():self.send_header(k,v)
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('X-Frame-Options','DENY')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        try:self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError):pass
    def trusted(self):
        origin='http://'+self.headers.get('Host','')
        return self.headers.get('Host')==f'127.0.0.1:{self.server.server_port}' and self.headers.get('Origin',origin)==origin
    def do_GET(self):
        if not self.trusted(): return self.send({'error':'Local access only'},403)
        path=self.path.split('?')[0]
        if path=='/':
            html=(ROOT/'static/index.html').read_text(encoding='utf-8').replace('__SESSION_KEY__',KEY).replace('__DESKTOP_MODE__','true' if getattr(self.server,'desktop_mode',False) else 'false')
            return self.send(html.encode(),mime='text/html; charset=utf-8')
        if path in ('/app.js','/style.css','/font.ttf','/metadata.js','/sdstudio-core.js','/sdstudio-core.js.map'):
            return self.send((ROOT/'static'/path[1:]).read_bytes(),mime=mimetypes.guess_type(path)[0] or 'text/plain')
        self.send({'error':'Not found'},404)
    def do_POST(self):
        global TOKEN
        if not self.trusted() or self.headers.get('X-Studio-Key')!=KEY: return self.send({'error':'창을 새로고침하세요.'},403)
        locked=False
        try:
            n=int(self.headers.get('Content-Length','0'))
            if not 0<n<=70*1024*1024: raise api.ApiError('요청 파일 크기를 확인하세요.')
            d=json.loads(self.rfile.read(n));path=self.path
            if path=='/api/state': return self.send(dict(connected=bool(TOKEN),canRemember=sys.platform=='win32'))
            if path=='/api/settings':
                if d.get('action')=='save':
                    data=d.get('data')
                    raw=json.dumps(data,ensure_ascii=False)
                    if not isinstance(data,dict) or len(raw)>512*1024: raise api.ApiError('설정 형식이 올바르지 않습니다.')
                    SETTINGS_FILE.parent.mkdir(parents=True,exist_ok=True)
                    tmp=SETTINGS_FILE.with_suffix('.tmp');tmp.write_text(raw,encoding='utf-8');os.replace(tmp,SETTINGS_FILE)
                    return self.send({'ok':True})
                try:data=json.loads(SETTINGS_FILE.read_text(encoding='utf-8'))
                except Exception:data={}
                return self.send({'data':data if isinstance(data,dict) else {}})
            if path=='/api/logout':
                TOKEN='';TOKEN_FILE.unlink(missing_ok=True);LEGACY_TOKEN_FILE.unlink(missing_ok=True);return self.send({'ok':True})
            if path=='/api/login':
                t=str(d.get('token','')).strip().removeprefix('Bearer ').strip()
                if not t or len(t)>16384 or any(c.isspace() for c in t): raise api.ApiError('NAI API 토큰을 확인하세요.')
                a=api.account(t)
                if d.get('remember'):
                    encrypted=protect(t.encode());TOKEN_FILE.parent.mkdir(parents=True,exist_ok=True);TOKEN_FILE.write_bytes(encrypted)
                else:TOKEN_FILE.unlink(missing_ok=True);LEGACY_TOKEN_FILE.unlink(missing_ok=True)
                TOKEN=t;return self.send(a)
            if not TOKEN: return self.send({'error':'NAI 토큰으로 먼저 연결하세요.'},401)
            token=TOKEN
            if path=='/api/account': return self.send(api.account(token))
            if path=='/api/relay':
                locked=LOCK.acquire(blocking=False)
                if not locked:return self.send({'error':'현재 요청이 처리 중입니다.'},409)
                raw,digest=api.relay(d,token)
                return self.send(raw,mime='application/zip',extra_headers={'X-Request-SHA256':digest})
            self.send({'error':'Not found'},404)
        except api.ApiError as e:self.send({'error':str(e)},400)
        except Exception:self.send({'error':'요청 처리에 실패했습니다. 입력 형식 또는 네트워크 상태를 확인하세요.'},500)
        finally:
            if locked:LOCK.release()

def main():
    global TOKEN
    parser=argparse.ArgumentParser();parser.add_argument('--no-browser',action='store_true');parser.add_argument('--desktop',action='store_true');parser.add_argument('--port',type=int,default=0);args=parser.parse_args()
    saved=TOKEN_FILE if TOKEN_FILE.exists() else LEGACY_TOKEN_FILE
    if saved.exists() and sys.platform=='win32':
        try:TOKEN=protect(saved.read_bytes(),True).decode()
        except Exception:pass
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    server.desktop_mode=args.desktop
    server.daemon_threads=True
    url=f'http://127.0.0.1:{server.server_port}'
    if args.desktop:
        # Electron owns this private stdin pipe. Closing/crashing the app closes
        # the pipe too, so a background server is never left behind.
        def watch_parent():
            try:sys.stdin.buffer.read()
            finally:server.shutdown()
        threading.Thread(target=watch_parent,daemon=True).start()
        print(json.dumps({'event':'ready','url':url}),flush=True)
    else:print('Refit Canvas 1.6.1\n'+url+'\nKeep this window open. Ctrl+C to stop.',flush=True)
    if not args.no_browser and not args.desktop:threading.Timer(.6,lambda:webbrowser.open(url)).start()
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
if __name__=='__main__':main()
