"""Compile the live game shaders with a surfaceless OpenGL ES 3 context."""
import ctypes as C
import json
import os
import subprocess
from pathlib import Path

os.environ.setdefault("EGL_PLATFORM", "surfaceless")
os.environ.setdefault("LIBGL_ALWAYS_SOFTWARE", "1")
egl = C.CDLL("libEGL.so.1")
handle = C.c_void_p
int_ = C.c_int
uint = C.c_uint
int_ptr = C.POINTER(int_)

# Shadow Flame and KHDR assemble GLSL with their internal imports. Capture
# the exact source pairs their constructors send to WebGL2.
source_probe = """
import {worldVS, worldFS, skyVS, skyFS, postVS} from './dist/js/shaders.js';
import {ShadowFlame} from './dist/js/shadowflame.js';
import {KHDRPipeline} from './dist/js/khdr.js';

const pairs = [[worldVS, worldFS], [skyVS, skyFS]];
const gl = new Proxy({
  createProgram: () => [],
  createShader: () => ({}),
  shaderSource: (shader, code) => { shader.code = code; },
  attachShader: (program, shader) => program.push(shader.code),
  linkProgram: program => pairs.push(program),
  getShaderParameter: () => true,
  getProgramParameter: (_, key) => key === 'ACTIVE_UNIFORMS' ? 0 : true,
  getParameter: () => 4096,
  getExtension: () => null,
  checkFramebufferStatus: () => 'FRAMEBUFFER_COMPLETE'
}, {
  get: (obj, key) => obj[key] ?? (/^[A-Z0-9_]+$/.test(key) ? key : () => {})
});
new ShadowFlame(gl, postVS);
new KHDRPipeline(gl, postVS);
console.log(JSON.stringify(pairs));
"""
repo = Path(__file__).resolve().parent.parent
pairs = json.loads(subprocess.check_output(
    ["node", "--input-type=module", "-e", source_probe], cwd=repo
))
names = ["world", "sky", "shadow depth", "shadow screen", "shadow resolve",
         "adapt 16", "adapt 4", "adapt 1", "bloom", "blur", "composite"]


def api(name, result, *args):
    fn = getattr(egl, name)
    fn.restype = result
    fn.argtypes = args
    return fn


def attribs(*values):
    return (int_ * len(values))(*values)


display = api("eglGetDisplay", handle, handle)(None)
init = api("eglInitialize", uint, handle, int_ptr, int_ptr)
assert init(display, None, None), "EGL initialization"
choose = api("eglChooseConfig", uint, handle, int_ptr, C.POINTER(handle), int_, int_ptr)
config, count = handle(), int_()
assert choose(display, attribs(0x3033, 1, 0x3040, 0x40, 0x3038), C.byref(config), 1, C.byref(count))
assert count.value, "OpenGL ES 3 pixel format"
assert api("eglBindAPI", uint, uint)(0x30A0)
surface = api("eglCreatePbufferSurface", handle, handle, handle, int_ptr)(
    display, config, attribs(0x3057, 32, 0x3056, 32, 0x3038)
)
context = api("eglCreateContext", handle, handle, handle, handle, int_ptr)(
    display, config, None, attribs(0x3098, 3, 0x3038)
)
assert surface and context and api("eglMakeCurrent", uint, handle, handle, handle, handle)(
    display, surface, surface, context
), "OpenGL ES 3 context"
address = api("eglGetProcAddress", handle, C.c_char_p)


def gl(name, result, *args):
    return C.CFUNCTYPE(result, *args)(address(("gl" + name).encode()))


get_string = gl("GetString", C.c_char_p, uint)
print(get_string(0x1F02).decode(), get_string(0x1F01).decode())
create_shader = gl("CreateShader", uint, uint)
set_source = gl("ShaderSource", None, uint, int_, C.POINTER(C.c_char_p), int_ptr)
compile_shader = gl("CompileShader", None, uint)
shader_status = gl("GetShaderiv", None, uint, uint, int_ptr)
shader_log = gl("GetShaderInfoLog", None, uint, int_, int_ptr, handle)
create_program = gl("CreateProgram", uint)
attach = gl("AttachShader", None, uint, uint)
link_program = gl("LinkProgram", None, uint)
program_status = gl("GetProgramiv", None, uint, uint, int_ptr)
program_log = gl("GetProgramInfoLog", None, uint, int_, int_ptr, handle)


def check(obj, field, name, get_status, get_log):
    ok = int_()
    get_status(obj, field, C.byref(ok))
    if not ok.value:
        log = C.create_string_buffer(8192)
        get_log(obj, len(log), None, log)
        raise AssertionError(f"{name}: {log.value.decode()}")


for name, sources in zip(names, pairs, strict=True):
    program = create_program()
    for kind, source in zip((0x8B31, 0x8B30), sources, strict=True):
        shader = create_shader(kind)
        data = C.c_char_p(source.encode())
        set_source(shader, 1, C.byref(data), None)
        compile_shader(shader)
        check(shader, 0x8B81, name, shader_status, shader_log)
        attach(program, shader)
    link_program(program)
    check(program, 0x8B82, name, program_status, program_log)
    print(f"{name} linked")
