// Log-encoded WebGL highlights cross to an extended-range canvas without a CPU readback.
export class HDRDisplay {
  constructor(canvas) {
    this.canvas = canvas;
    this.active = false;
    this.available = false;
    this.media = matchMedia('(dynamic-range: high)');
    this.pending = null;
    this.want = false;
    this.khdr = false;
    this.onModeChange = () => this.choose(this.want, this.khdr);
    this.media.addEventListener?.('change', this.onModeChange);
  }
  async choose(on, khdr = false) {
    if (this.disposed) return;
    this.want = !!(on || khdr);
    this.khdr = !!khdr;
    if (!this.want || !this.media.matches || !navigator.gpu) {
      this.active = false;
      this.canvas.hidden = true;
      return
    }
    if (!this.pending)this.pending = this.init().catch (() => {
      this.available = false;
    });
    await this.pending;
    this.active = !!(this.want && this.available && this.media.matches);
    this.canvas.hidden = !this.active
  }
  async init() {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter)return;
    const device = await adapter.requestDevice(), ctx = this.canvas.getContext('webgpu');
    if (!ctx || this.disposed) {
      device.destroy();
      return;
    }
    let invalid = false;
    device.addEventListener('uncapturederror', () => {
      invalid = true;
      if (this.device === device) {
        this.available = this.active = false;
        this.canvas.hidden = true;
      }
    });
    try {
      ctx.configure({device, format: 'rgba16float', toneMapping: {mode: 'extended'}, alphaMode: 'opaque', colorSpace: 'srgb'});
      if (ctx.getConfiguration && ctx.getConfiguration()?.toneMapping?.mode !== 'extended') {
        device.destroy();
        return;
      }
    } catch (error) {
      device.destroy();
      throw error;
    }
    const makePipe = scalePow => {
      const mod = device.createShaderModule({code: `@group(0) @binding(0) var src:texture_2d<f32>; @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {let p=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.-1.;return vec4f(p,0.,1.);} @fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f {let v=textureLoad(src,vec2i(p.xy),0).rgb;return vec4f(exp2(v*${scalePow})-1.,1.);}`});
      return device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: {module: mod, entryPoint: 'vs'},
        fragment: {module: mod, entryPoint: 'fs', targets: [{format: 'rgba16float'}]},
        primitive: {topology: 'triangle-list'}
      });
    };
    let pipelines;
    try {
      pipelines = await Promise.all([makePipe('3.'), makePipe('4.')]);
    } catch (error) {
      device.destroy();
      throw error;
    }
    if (this.disposed || invalid) {
      device.destroy();
      return;
    }
    const [pipeline, pipelineKHDR] = pipelines;
    this.device = device;
    this.ctx = ctx;
    this.pipeline = pipeline;
    this.pipelineKHDR = pipelineKHDR;
    this.available = true;
    device.lost.then(() => {
      this.active = this.available = false;
      this.canvas.hidden = true;
      this.src = null;
      this.w = this.h = 0;
      this.pending = null;
    })
  }

  dispose() {
    this.disposed = true;
    this.want = false;
    this.active = false;
    this.canvas.hidden = true;
    this.media.removeEventListener?.('change', this.onModeChange);
    this.src?.destroy();
    this.ctx?.unconfigure();
    this.device?.destroy();
  }
  present(source) {
    if (!this.active)return;
    try {
      const {device, ctx} = this;
      const pipe = this.khdr && this.pipelineKHDR ? this.pipelineKHDR : this.pipeline;
      const w = source.width, h = source.height;
      if (this.w !== w || this.h !== h) {
        this.w = w;
        this.h = h;
        this.canvas.width = w;
        this.canvas.height = h;
        this.src?.destroy();
        this.src = device.createTexture({size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT});
        this.group = device.createBindGroup({layout: this.pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: this.src.createView()}]});
        this.groupKHDR = device.createBindGroup({layout: this.pipelineKHDR.getBindGroupLayout(0), entries: [{binding: 0, resource: this.src.createView()}]})
      }
      device.queue.copyExternalImageToTexture({source}, {texture: this.src}, [w, h]);
      const enc = device.createCommandEncoder(),
        p = enc.beginRenderPass({colorAttachments: [{view: ctx.getCurrentTexture().createView(), clearValue: {r: 0, g: 0, b: 0, a: 1}, loadOp: 'clear', storeOp: 'store'}]});
      p.setPipeline(pipe);
      p.setBindGroup(0, pipe === this.pipelineKHDR ? this.groupKHDR : this.group);
      p.draw(3);
      p.end();
      device.queue.submit([enc.finish()])
    } catch {
      this.active = this.available = false;
      this.canvas.hidden = true
    }
  }
}
