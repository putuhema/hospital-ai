"""Create editable hospital modules with Blender; export individual GLB assets."""
import bpy, math, os
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'static','models')
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def mat(name, color, metallic=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1);b.inputs['Metallic'].default_value=metallic;b.inputs['Roughness'].default_value=.45
 return m
white=mat('Porcelain concrete',(.83,.86,.82));glass=mat('Blue tinted glazing',(.16,.34,.40),.4);frame=mat('Window frames',(.25,.32,.31));roof=mat('Standing seam roof',(.39,.46,.44));red=mat('Medical red',(.75,.13,.12));floor=mat('Foundation',(.48,.52,.49));metal=mat('Mechanical equipment',(.62,.68,.67),.5)
colors={'pitched':(.83,.86,.82),'flat':(.83,.86,.82)}
modules=[]
def box(name,loc,scale,material,bevel=.04):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material)
 if bevel:
  m=o.modifiers.new('Soft architectural edges','BEVEL');m.width=bevel;m.segments=2
  o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 return o
def label(text,loc,size=.35):
 bpy.ops.object.text_add(location=loc,rotation=(math.pi/2,0,0));o=bpy.context.object;o.name='Sign '+text;o.data.body=text;o.data.align_x='CENTER';o.data.size=size;o.data.extrude=.008;o.data.materials.append(white)
 bpy.ops.object.convert(target='MESH')
def build(kind,w,d):
 start=set(bpy.data.objects);accent=mat('Facade '+kind,colors.get(kind,(.66,.69,.61)))
 if kind in colors:
  height=3.6
  box('Foundation',(w/2,d/2,.12),(w,d,.24),floor)
  box('Building shell',(w/2,d/2,height/2+.24),(w-.2,d-.2,height),white)
  if kind=='pitched':
   # Gabled roof: two pitched planes, triangular end walls, white fascia and tile courses.
   eave=height+.32; rise=w*.27; half=w/2+.28; slope=math.atan2(rise,half)
   mesh=bpy.data.meshes.new('Triangular gable mesh')
   mesh.from_pydata([(0,0,eave),(w,0,eave),(w/2,0,eave+rise),(0,d,eave),(w,d,eave),(w/2,d,eave+rise)],[],[(0,2,1),(3,4,5),(0,3,5,2),(1,2,5,4),(0,1,4,3)])
   gable=bpy.data.objects.new('Triangular gable walls',mesh);bpy.context.collection.objects.link(gable);gable.data.materials.append(white)
   roof_material=mat('Teal roof tiles '+kind,(.08,.29,.31))
   for side in [-1,1]:
    panel=box('Pitched roof plane',(w/2+side*half/2,d/2,eave+rise/2),(math.hypot(half,rise),d+.6,.15),roof_material)
    panel.rotation_euler.y=side*slope
    for y in [-.32,d+.32]:
     trim=box('White gable fascia',(w/2+side*half/2,y,eave+rise/2-.06),(math.hypot(half,rise),.14,.23),white)
     trim.rotation_euler.y=side*slope
    for n in range(1,11):
     t=n/11
     box('Roof tile course',(w/2+side*half*t,d/2,eave+rise*(1-t)+.1),(.06,d+.6,.055),roof_material,.015)
   box('Roof ridge cap',(w/2,d/2,eave+rise+.1),(.19,d+.7,.17),roof_material)
  else:
   box('Flat roof slab',(w/2,d/2,height+.38),(w+.3,d+.3,.28),white)
  box('Entrance door frame',(w/2,-.15,1.3),(1.65,.28,2.3),frame)
  box('Entrance double glass doors',(w/2,-.31,1.25),(1.45,.08,2.1),glass)
  box('Door mullion',(w/2,-.37,1.25),(.055,.055,2.1),metal)
 else:
  # One continuous slab per surface: no tile seams or overlapping internal faces.
  outlines={
   'straight':[(0,0),(w,0),(w,d),(0,d)],
   'corner':[(0,0),(2,0),(2,2),(4,2),(4,4),(0,4)],
   'junction':[(0,0),(6,0),(6,2),(4,2),(4,4),(2,4),(2,2),(0,2)],
   'cross':[(2,0),(4,0),(4,2),(6,2),(6,4),(4,4),(4,6),(2,6),(2,4),(0,4),(0,2),(2,2)]}
  outline=outlines[kind]
  def slab(name,bottom,top,material):
   n=len(outline);verts=[(x,y,z) for z in [bottom,top] for x,y in outline]
   faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
   mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
   obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);obj.data.materials.append(material)
   bevel=obj.modifiers.new('Edge finish','BEVEL');bevel.width=.025;bevel.segments=2
   obj.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
  slab('Continuous corridor floor',0,.24,floor)
  slab('Continuous corridor roof',2.76,2.94,roof)
  # Sparse paired supports sit on side boundaries, away from every open end.
  side_posts={'straight':[(w/2,.08),(w/2,d-.08)],
   'corner':[(.08,2),(2,2.08)],
   'junction':[(2.08,2.08),(3.92,2.08)],
   'cross':[(2.04,2.04),(3.96,2.04),(2.04,3.96),(3.96,3.96)]}
  for x,y in side_posts[kind]:
   box('Side support post',(x,y,1.5),(.10,.10,2.52),metal,.01)
 objects=list(set(bpy.data.objects)-start)
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0]
 bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,kind+'.glb'),export_format='GLB',use_selection=True,export_apply=True)
 collection=bpy.data.collections.new(kind.title()+' module');bpy.context.scene.collection.children.link(collection)
 for o in objects:
  for c in list(o.users_collection):c.objects.unlink(o)
  collection.objects.link(o)
 modules.append((kind,objects,w,d))
for kind,w,d in [('pitched',10,8),('flat',10,8),('straight',8,2),('corner',4,4),('junction',6,4),('cross',6,6)]:build(kind,w,d)
# Arrange an editable asset collection for inspection in Blender.
for i,(kind,objects,w,d) in enumerate(modules):
 for o in objects:o.location.x+=(i%4)*14;o.location.y+=(i//4)*15
world=bpy.context.scene.world;world.color=(.7,.7,.7)
bpy.ops.object.light_add(type='AREA',location=(18,-5,30));bpy.context.object.data.energy=3500;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=25
bpy.ops.object.camera_add(location=(48,-42,48));cam=bpy.context.object;cam.rotation_euler=(Vector((24,9,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=65;bpy.context.scene.camera=cam
bpy.context.scene.render.engine='CYCLES';bpy.context.scene.cycles.samples=24;bpy.context.scene.render.resolution_x=1600;bpy.context.scene.render.resolution_y=1000;bpy.context.scene.render.resolution_percentage=100
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'hospital-assets.blend'))
print('HOSPITAL ASSET GENERATION COMPLETE')
