import bpy, os
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'static/models/hospital-assets.blend'))
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16;scene.render.resolution_x=400;scene.render.resolution_y=300;scene.render.resolution_percentage=100;scene.render.film_transparent=True
collections=[c for c in bpy.data.collections if c.name.endswith(' module')]
for c in collections:c.hide_render=True
for collection in collections:
 collection.hide_render=False
 coords=[o.matrix_world@Vector(v) for o in collection.objects if o.type=='MESH' for v in o.bound_box]
 lo=Vector(tuple(min(v[i] for v in coords) for i in range(3)));hi=Vector(tuple(max(v[i] for v in coords) for i in range(3)));center=(lo+hi)/2
 cam=scene.camera;cam.location=center+Vector((13,-18,14));cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=max(hi.x-lo.x,hi.y-lo.y)*1.5
 light=next(o for o in scene.objects if o.type=='LIGHT');light.location=center+Vector((-3,-5,15));light.data.energy=2500;light.data.size=10
 scene.render.filepath=os.path.join(ROOT,'static/models',collection.name.split()[0].lower()+'.png');bpy.ops.render.render(write_still=True)
 collection.hide_render=True
