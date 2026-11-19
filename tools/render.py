from pathlib import Path
import bpy,math,json,numpy as np
from mathutils import Vector
p=Path(__file__).resolve().parent
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24;scene.cycles.use_denoising=False;scene.cycles.max_bounces=4;scene.cycles.diffuse_bounces=2;scene.cycles.glossy_bounces=2;scene.cycles.transparent_max_bounces=6
scene.render.threads_mode='FIXED';scene.render.threads=10;scene.render.resolution_x=2048;scene.render.resolution_y=1248;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=0
world=bpy.data.worlds.new('Sea air');scene.world=world;world.use_nodes=True;n=world.node_tree.nodes;l=world.node_tree.links;bg=n.get('Background');env=n.new('ShaderNodeTexEnvironment');env.image=bpy.data.images.load(str(p/'sky-env.jpg'));l.new(env.outputs['Color'],bg.inputs['Color']);bg.inputs['Strength'].default_value=.95
sun=bpy.data.lights.new('Afternoon sun','SUN');sun.energy=4.2;sun.angle=math.radians(.9);sun.color=(1.0,.80,.565);so=bpy.data.objects.new('Afternoon sun',sun);scene.collection.objects.link(so);so.rotation_euler=Vector((.78,.46,-.39)).to_track_quat('-Z','Y').to_euler()
raw=np.fromfile(p/'mesh.bin','<f4').reshape((-1,3,13));winding=np.cross(raw[:,1,:3]-raw[:,0,:3],raw[:,2,:3]-raw[:,0,:3]);flip=np.einsum('ij,ij->i',winding,raw[:,:,3:6].mean(axis=1))<0;raw[flip]=raw[flip][:,[0,2,1],:];raw=raw.reshape((-1,13));layout=json.loads((p/'layers.json').read_text());names={v:k for k,v in layout.items()}
mats=[]
for ni in range(len(names)):
 name=names[ni];m=bpy.data.materials.new(name);m.use_nodes=True;nt=m.node_tree;nodes=nt.nodes;ln=nt.links;bs=nodes.get('Principled BSDF');fac=nodes.new('ShaderNodeVertexColor');fac.layer_name='Tint';base=fac.outputs['Color'];metal= name in ['steel','panel','blackMetal','shutter','tread','barrel','rivets','greenHull','redPaint','drain','grate'];bs.inputs['Metallic'].default_value=.36 if metal else .035;bs.inputs['Roughness'].default_value=.45 if metal else .72
 if name!='white':
  tex=nodes.new('ShaderNodeTexImage');pic=bpy.data.images.load(str(p/(name+'.png')));tex.image=pic;mul=nodes.new('ShaderNodeMixRGB');mul.blend_type='MULTIPLY';mul.inputs[0].default_value=1;ln.new(tex.outputs['Color'],mul.inputs[1]);ln.new(base,mul.inputs[2]);base=mul.outputs[0]
  if name.startswith('label'):ln.new(tex.outputs['Alpha'],bs.inputs['Alpha']);bs.inputs['Roughness'].default_value=.64
  else:
   bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.29 if metal else .18;bump.inputs['Distance'].default_value=.018 if name!='panel' else .085;ln.new(tex.outputs['Color'],bump.inputs['Height']);ln.new(bump.outputs['Normal'],bs.inputs['Normal'])
 ln.new(base,bs.inputs['Base Color']);mats.append(m)
mesh=bpy.data.meshes.new('Harbor');co=raw[:,:3][:,[0,2,1]].copy();co[:,1]*=-1;num=len(raw);nfaces=num//3;mesh.vertices.add(num);mesh.vertices.foreach_set('co',co.ravel());mesh.loops.add(num);mesh.loops.foreach_set('vertex_index',np.arange(num,dtype='i'));mesh.polygons.add(nfaces);mesh.polygons.foreach_set('loop_start',np.arange(0,num,3,dtype='i'));mesh.polygons.foreach_set('loop_total',np.full(nfaces,3,dtype='i'));obj=bpy.data.objects.new('Cargo berth',mesh);scene.collection.objects.link(obj)
for m in mats:mesh.materials.append(m)
mesh.polygons.foreach_set('material_index',raw[::3,8].astype('i'));uv=raw[:,6:8].copy();uv[:,1]=1-uv[:,1];mesh.uv_layers.new(name='Surface').data.foreach_set('uv',uv.ravel());col=np.ones((num,4),'f');col[:,:3]=np.maximum(.001,raw[:,9:12])**2.2;mesh.color_attributes.new(name='Tint',type='FLOAT_COLOR',domain='POINT').data.foreach_set('color',col.ravel());mesh.update()
# Surface normals are shared with the game, including the rounded tank walls and hulls.
norm=raw[:,3:6][:,[0,2,1]].copy();norm[:,1]*=-1;mesh.polygons.foreach_set('use_smooth',np.full(nfaces,True));mesh.normals_split_custom_set_from_vertices(norm.tolist())
# Rippling basin, physically reflective wet surfaces and atmospheric distance.
bpy.ops.mesh.primitive_plane_add(size=1700,location=(0,0,-1.68));sea=bpy.context.object;wm=bpy.data.materials.new('Harbor water');wm.use_nodes=True;nt=wm.node_tree;n=nt.nodes;l=nt.links;bs=n.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.013,.078,.083,1);bs.inputs['Metallic'].default_value=.32;bs.inputs['Roughness'].default_value=.185;bs.inputs['IOR'].default_value=1.334;coord=n.new('ShaderNodeTexCoord');mapping=n.new('ShaderNodeVectorMath');mapping.operation='MULTIPLY';mapping.inputs[1].default_value=(1.35,3.3,1);l.new(coord.outputs['Object'],mapping.inputs[0]);noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=1.05;noise.inputs['Detail'].default_value=3.3;noise.inputs['Roughness'].default_value=.56;l.new(mapping.outputs[0],noise.inputs[0]);bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.19;bump.inputs['Strength'].default_value=.39;l.new(noise.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs[0],bs.inputs['Normal']);sea.data.materials.append(wm)
# Fog from the camera's distance pass leaves the play area sharp and layers the far shoreline.
scene.use_nodes=True;scene.view_layers[0].use_pass_mist=True;world.mist_settings.start=15;world.mist_settings.depth=480;world.mist_settings.falloff='LINEAR';nt=scene.node_tree;nt.nodes.clear();rn=nt.nodes.new('CompositorNodeRLayers');mix=nt.nodes.new('CompositorNodeMixRGB');mix.blend_type='MIX';mult=nt.nodes.new('CompositorNodeMath');mult.operation='MULTIPLY';mult.inputs[1].default_value=.38;nt.links.new(rn.outputs['Mist'],mult.inputs[0]);nt.links.new(mult.outputs[0],mix.inputs[0]);nt.links.new(rn.outputs['Image'],mix.inputs[1]);mix.inputs[2].default_value=(.46,.56,.59,1);out=nt.nodes.new('CompositorNodeComposite');nt.links.new(mix.outputs[0],out.inputs[0]);
camera=bpy.data.cameras.new('Harbor survey');cam=bpy.data.objects.new('Harbor survey',camera);scene.collection.objects.link(cam);scene.camera=cam;camera.clip_end=1400
scene.render.image_settings.file_format='JPEG';scene.render.image_settings.quality=94
# The three cameras use the same metric game world. The broad capture leaves room for the title pan.
shots=[((12,7.25,98),(-15,9.9,8),76),((-37,8.1,91),(-14,9.6,4),78),((20,6.3,9),(-18,8,-56),68)]
for i,(eye,target,fov) in enumerate(shots):
 cam.location=(eye[0],-eye[2],eye[1]);dest=Vector((target[0],-target[2],target[1]));cam.rotation_euler=(dest-cam.location).to_track_quat('-Z','Y').to_euler();camera.lens=36/(2*math.tan(math.radians(fov)/2));scene.render.filepath=str(p/f'harbor-{i+1}.jpg');bpy.ops.render.render(write_still=True)
