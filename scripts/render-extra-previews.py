"""Render library thumbnails for pieces the app builds itself (L-shaped building, garden path).

Uses the same materials, light and camera as render-hospital-previews.py:
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/render-extra-previews.py
"""
import bpy, math, os
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'static/models/hospital-assets.blend'))
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16;scene.render.resolution_x=400;scene.render.resolution_y=300;scene.render.resolution_percentage=100;scene.render.film_transparent=True
for c in bpy.data.collections:c.hide_render=True
# The saved world uses its node tree; light it like the module previews' flat grey world.
bg=scene.world.node_tree.nodes.get('Background')
if bg:bg.inputs['Color'].default_value=(.7,.7,.7,1);bg.inputs['Strength'].default_value=1
M=bpy.data.materials
white=M['Porcelain concrete'];roof=M['Teal roof tiles pitched'];frame=M['Window frames'];glass=M['Blue tinted glazing'];floor=M['Foundation']
def mat(name,color):
 m=bpy.data.materials.new(name);m.use_nodes=True;m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*color,1);m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.9;return m
def box(col,name,loc,size,material,rot=None):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size
 if rot:o.rotation_euler=rot
 o.data.materials.append(material)
 for c in list(o.users_collection):c.objects.unlink(o)
 col.objects.link(o);return o
def prism(col,name,verts,faces,material):
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);o=bpy.data.objects.new(name,mesh);o.data.materials.append(material);col.objects.link(o);return o
def gable(col,x0,y0,x1,y1,along_x,ends):
 """Pitched roof over a rectangle; `ends` says which ends get a gable wall and overhang."""
 eave=3.92;span=(y1-y0) if along_x else (x1-x0);half=span/2+.28;rise=half*.5;slope=math.atan2(rise,half)
 lo=(x0 if along_x else y0)-(.3 if ends[0] else 0);hi=(x1 if along_x else y1)+(.3 if ends[1] else 0);mid=(lo+hi)/2;cx=(x0+x1)/2;cy=(y0+y1)/2
 for s in (-1,1):
  if along_x:box(col,'Roof plane',(mid,cy+s*half/2,eave+rise/2),(hi-lo,math.hypot(half,rise),.15),roof,(-s*slope,0,0))
  else:box(col,'Roof plane',(cx+s*half/2,mid,eave+rise/2),(math.hypot(half,rise),hi-lo,.15),roof,(0,s*slope,0))
 box(col,'Ridge',(mid if along_x else cx,cy if along_x else mid,eave+rise+.1),(hi-lo+.1 if along_x else .19,.19 if along_x else hi-lo+.1,.17),roof)
 for i,show in enumerate(ends):
  if not show:continue
  at=(x1 if i else x0) if along_x else (y1 if i else y0)
  p=(lambda v,z:(at,v,z)) if along_x else (lambda v,z:(v,at,z))
  a,b=(y0,y1) if along_x else (x0,x1)
  prism(col,'Gable',[p(a,eave),p(b,eave),p((a+b)/2,eave+rise)],[(0,1,2)],white)
def render(col,name):
 coords=[o.matrix_world@Vector(v) for o in col.objects if o.type=='MESH' for v in o.bound_box]
 lo=Vector(tuple(min(v[i] for v in coords) for i in range(3)));hi=Vector(tuple(max(v[i] for v in coords) for i in range(3)));center=(lo+hi)/2
 cam=scene.camera;cam.location=center+Vector((13,-18,14));cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=max(hi.x-lo.x,hi.y-lo.y)*1.5
 light=next(o for o in scene.objects if o.type=='LIGHT');light.location=center+Vector((-3,-5,15));light.data.energy=2500;light.data.size=10
 col.hide_render=False;scene.render.filepath=os.path.join(ROOT,'static/models',name+'.png');bpy.ops.render.render(write_still=True);col.hide_render=True

# L-shaped building, 12 x 12 m with the north-east quarter cut away (Blender y points north).
col=bpy.data.collections.new('L-shape preview');scene.collection.children.link(col)
W=D=12;H=3.6
outline=[(0,0),(W,0),(W,D/2),(W/2,D/2),(W/2,D),(0,D)]
n=len(outline)
prism(col,'Walls',[(x,y,z) for z in (.24,H+.24) for x,y in outline],[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],white)
prism(col,'Foundation',[(x,y,z) for z in (0,.24) for x,y in outline],[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],floor)
for x in (1.5,4.5,7.5,10.5):
 box(col,'Window',(x,-.04,2.1),(1.3,.08,1.3),glass)
for y in (1.5,4.5,7.5,10.5):
 box(col,'Window',(-.04,y,2.1),(.08,1.3,1.3),glass)
box(col,'Door',(W*.75,-.06,1.2),(1.4,.1,2.1),frame)
gable(col,0,0,W,D/2,True,(True,True))
gable(col,0,D/4,W/2,D,False,(False,True))
render(col,'l-shape')

# Garden path: 8 x 2 m of paving with kerbs on the long sides.
col=bpy.data.collections.new('Path preview');scene.collection.children.link(col)
box(col,'Paving',(4,1,.03),(8,2,.06),mat('Path paving',(.60,.56,.47)))
kerb=mat('Kerb',(.33,.33,.30))
for y in (.06,1.94):box(col,'Kerb',(4,y,.05),(8,.12,.1),kerb)
box(col,'Lawn',(4,1,-.02),(9.5,4,.04),mat('Lawn',(.36,.47,.29)))
render(col,'path')
print('EXTRA PREVIEWS COMPLETE')
