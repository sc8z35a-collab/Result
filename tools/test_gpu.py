import ctypes as C,os,json
from pathlib import Path
os.environ['EGL_PLATFORM']='surfaceless';os.environ['LIBGL_ALWAYS_SOFTWARE']='1';lib=C.CDLL('libEGL.so.1');vp=C.c_void_p;u=C.c_uint;i=C.c_int;f=C.c_float;pi=C.POINTER(i);sz=C.c_ssize_t

def api(name,rest,*args):
 fn=getattr(lib,name);fn.restype=rest;fn.argtypes=args;return fn
get=api('eglGetDisplay',vp,vp);init=api('eglInitialize',u,vp,pi,pi);choose=api('eglChooseConfig',u,vp,pi,C.POINTER(vp),i,pi);bind=api('eglBindAPI',u,u);ctx=api('eglCreateContext',vp,vp,vp,vp,pi);surf=api('eglCreatePbufferSurface',vp,vp,vp,pi);make=api('eglMakeCurrent',u,vp,vp,vp,vp);addr=api('eglGetProcAddress',vp,C.c_char_p);A=lambda *a:(i*len(a))(*a);display=get(None);major=i();minor=i();assert init(display,C.byref(major),C.byref(minor));conf=vp();count=i();assert choose(display,A(0x3033,1,0x3040,0x40,0x3024,8,0x3023,8,0x3022,8,0x3021,8,0x3025,24,0x3038),C.byref(conf),1,C.byref(count)) and count.value;assert bind(0x30A0);surface=surf(display,conf,A(0x3057,64,0x3056,64,0x3038));context=ctx(display,conf,None,A(0x3098,3,0x3038));assert context and make(display,surface,surface,context)
def gl(n,t,*args):return C.CFUNCTYPE(t,*args)(addr(('gl'+n).encode()))
string=gl('GetString',C.c_char_p,u);print(string(0x1f02).decode(),string(0x1f01).decode());srcs=json.loads((Path(__file__).parent/'glsl.json').read_text());create=gl('CreateShader',u,u);src=gl('ShaderSource',None,u,i,C.POINTER(C.c_char_p),pi);compileS=gl('CompileShader',None,u);status=gl('GetShaderiv',None,u,u,pi);log=gl('GetShaderInfoLog',None,u,i,pi,vp);prg=gl('CreateProgram',u);attach=gl('AttachShader',None,u,u);link=gl('LinkProgram',None,u);pstatus=gl('GetProgramiv',None,u,u,pi);plog=gl('GetProgramInfoLog',None,u,i,pi,vp)
for prefix in ['world','sky','shadow']:
 p=prg()
 for suffix,typ in [('VS',0x8B31),('FS',0x8B30)]:
  shader=create(typ);data=C.c_char_p(srcs[prefix+suffix].encode());src(shader,1,C.byref(data),None);compileS(shader);ok=i();status(shader,0x8B81,C.byref(ok));out=C.create_string_buffer(8192);log(shader,8192,None,out);assert ok.value,(prefix+suffix,out.value.decode());attach(p,shader)
 link(p);ok=i();pstatus(p,0x8B82,C.byref(ok));out=C.create_string_buffer(8192);plog(p,8192,None,out);assert ok.value,(prefix,out.value.decode());print(prefix,'linked')
