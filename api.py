"""Authenticated local transport for the actual SDStudio TypeScript service.

No image-generation payload builder is implemented here. The UTF-8 JSON string
produced by SDStudio is validated, then forwarded byte-for-byte unchanged.
"""
import base64,json,struct,urllib.request,urllib.error
from hashlib import sha256
HOST='https://image.novelai.net'
class ApiError(Exception):pass

def png(data):
    try:b=base64.b64decode(data.split(',')[-1],validate=True)
    except Exception:raise ApiError('PNG 데이터가 올바르지 않습니다.')
    if len(b)>32*1024*1024 or len(b)<24 or b[:8]!=b'\x89PNG\r\n\x1a\n':raise ApiError('32MB 이하의 PNG가 필요합니다.')
    w,h=struct.unpack('>II',b[16:24])
    if not 0<w*h<=16777216:raise ApiError('이미지 해상도를 확인하세요.')
    return w,h

def perform(path,token,wire=None):
    req=urllib.request.Request(HOST+path,data=wire,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'application/zip' if wire is not None else 'application/json','User-Agent':'Refit-Canvas/1.6.2'})
    try:
        with urllib.request.urlopen(req,timeout=300 if wire is not None else 30) as r:return r.read(70*1024*1024)
    except urllib.error.HTTPError as e:
        msg=e.read(4096).decode('utf-8','replace').replace(token,'[REDACTED]')
        try:msg=json.loads(msg).get('message',msg)
        except Exception:pass
        raise ApiError(f'NAI 요청 실패 (HTTP {e.code}): {str(msg)[:500]}') from None
    except (TimeoutError,OSError):raise ApiError('NAI 연결이 끊겼거나 시간이 초과되었습니다. 자동 재시도하지 않았습니다. 잔액을 확인한 뒤 다시 요청하세요.') from None

def account(token):
    raw=json.loads(perform('/user/data',token));sub=raw.get('subscription',{});steps=sub.get('trainingStepsLeft',{})
    usage=sub.get('usage') if sub.get('active') and sub.get('tier')==3 else None
    return dict(active=sub.get('active'),tier=sub.get('tier'),fixed=steps.get('fixedTrainingStepsLeft'),purchased=steps.get('purchasedTrainingSteps'),usage=usage,expiresAt=sub.get('expiresAt'))

def relay(d,token):
    operation=d.get('operation');serialized=d.get('serializedBody')
    if operation not in ('generate','upscale') or not isinstance(serialized,str) or len(serialized)>65*1024*1024:raise ApiError('SDStudio 요청 형식이 올바르지 않습니다.')
    try:body=json.loads(serialized)
    except Exception:raise ApiError('요청 JSON이 올바르지 않습니다.')
    if not isinstance(body,dict):raise ApiError('요청 본문이 올바르지 않습니다.')
    if operation=='generate':
        if body.get('action')!='infill' or body.get('model') not in ('nai-diffusion-5-full-inpainting','nai-diffusion-4-5-full-inpainting','nai-diffusion-4-5-curated-inpainting'):raise ApiError('인페인트 전용 요청이 필요합니다.')
        p=body.get('parameters',{});w,h=p.get('width'),p.get('height')
        if not isinstance(w,int) or not isinstance(h,int) or w<64 or h<64 or w%64 or h%64 or w*h>3145728:raise ApiError('캔버스 해상도를 확인하세요.')
        if png(p.get('image',''))!=(w,h) or png(p.get('mask',''))!=(w,h):raise ApiError('이미지·마스크·캔버스 크기가 다릅니다.')
        path='/ai/generate-image'
    else:
        if body.get('model')!='nai-diffusion-5-curated':raise ApiError('지원하지 않는 업스케일 요청입니다.')
        w,h=png(body.get('image',''))
        if w*h>3145728:raise ApiError('업스케일 입력 해상도를 초과했습니다.')
        path='/ai/upscale'
    wire=serialized.encode('utf-8')
    # No re-serialization, field insertion, prompt changes or PNG conversion.
    return perform(path,token,wire),sha256(wire).hexdigest()
