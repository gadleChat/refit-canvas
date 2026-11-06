import unittest,json,base64,struct,zlib,sys,threading,urllib.request,urllib.error,hashlib
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import api,server

def png():
 def chunk(t,b):return struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b)&0xffffffff)
 data=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',64,64,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+b'\xff\xff\xff'*64)*64))+chunk(b'IEND',b'')
 return base64.b64encode(data).decode()
def body():return {'model':'nai-diffusion-5-full-inpainting','action':'infill','input':'한글 원본, 1.5::태그::','parameters':{'width':64,'height':64,'seed':0,'image':png(),'mask':png(),'img2img':{'strength':1,'noise':0},'tag_hint_transparent_background':False}}
def request():return {'operation':'generate','serializedBody':json.dumps(body(),ensure_ascii=False,indent=3)}
class RelayTests(unittest.TestCase):
 def test_exact_utf8_payload_forwarding(self):
  d=request()
  with patch.object(api,'perform',return_value=b'ZIP') as network:
   raw,h=api.relay(d,'mock-token');self.assertEqual(raw,b'ZIP');network.assert_called_once_with('/ai/generate-image','mock-token',d['serializedBody'].encode())
   self.assertEqual(h,hashlib.sha256(d['serializedBody'].encode()).hexdigest())
 def test_invalid_request_never_sent(self):
  variants=[{'operation':'other','serializedBody':'{}'},{'operation':'generate','serializedBody':'not json'}]
  for field,value in [('action','img2img'),('model','nai-diffusion-5-full')]:
   b=body();b[field]=value;variants.append({'operation':'generate','serializedBody':json.dumps(b)})
  for d in variants:
   with self.subTest(d=d['operation']),patch.object(api,'perform') as network:
    with self.assertRaises(api.ApiError):api.relay(d,'mock-token')
    network.assert_not_called()
 def test_dimension_mismatch_never_sent(self):
  b=body();b['parameters']['width']=128
  with patch.object(api,'perform') as network:
   with self.assertRaises(api.ApiError):api.relay({'operation':'generate','serializedBody':json.dumps(b)},'mock-token')
   network.assert_not_called()
 def test_upscale_body_unchanged(self):
  wire=json.dumps({'image':png(),'model':'nai-diffusion-5-curated','declared_blur_sigma':0})
  with patch.object(api,'perform',return_value=b'ZIP') as network:
   api.relay({'operation':'upscale','serializedBody':wire},'mock-token');network.assert_called_once_with('/ai/upscale','mock-token',wire.encode())
 def test_no_retry_on_failure(self):
  with patch.object(api,'perform',side_effect=api.ApiError('timeout')) as network:
   with self.assertRaises(api.ApiError):api.relay(request(),'mock-token')
   self.assertEqual(network.call_count,1)
 def test_account_usage_absence(self):
  with patch.object(api,'perform',return_value=json.dumps({'subscription':{'active':True,'tier':3}}).encode()):self.assertIsNone(api.account('mock-token')['usage'])
 def test_vendor_files_unchanged(self):
  meta=json.loads((ROOT/'source/UPSTREAM.json').read_text())
  for path,digest in meta['files'].items():
   with self.subTest(path=path):self.assertEqual(hashlib.sha256((ROOT/'source/vendor/SDStudio'/path).read_bytes()).hexdigest(),digest)
 def test_http_bridge_preserves_zip_and_request_bytes(self):
  app=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler);thread=threading.Thread(target=app.serve_forever,daemon=True);thread.start();old=server.TOKEN;server.TOKEN='mock-token';base='http://127.0.0.1:'+str(app.server_port)
  try:
   with patch.object(api,'perform',return_value=b'PK-mock-zip\x00\xff') as network:
    d=request();req=urllib.request.Request(base+'/api/relay',data=json.dumps(d).encode(),headers={'Content-Type':'application/json','X-Studio-Key':server.KEY})
    with urllib.request.urlopen(req) as response:
     self.assertEqual(response.read(),b'PK-mock-zip\x00\xff');self.assertEqual(response.headers['X-Request-SHA256'],hashlib.sha256(d['serializedBody'].encode()).hexdigest())
    network.assert_called_once_with('/ai/generate-image','mock-token',d['serializedBody'].encode())
   req=urllib.request.Request(base+'/api/relay',data=b'{}',headers={'Content-Type':'application/json'})
   with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(req)
   self.assertEqual(error.exception.code,403)
  finally:server.TOKEN=old;app.shutdown();app.server_close();thread.join(timeout=2)
if __name__=='__main__':unittest.main()
