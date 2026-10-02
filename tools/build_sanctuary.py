"""
Aura premiere model — dusk sanctuary.
Reconstructed from grok-video-00d9aa32 (cabin, LED deck, steel arch nest, wood-fired tub).
Blender 5.2, Z-up. glTF exporter converts to Y-up.
"""
from __future__ import annotations

import math
import os
import sys
from mathutils import Vector, Euler, Matrix

import bpy
import bmesh
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "models")
BLEND_OUT = os.path.join(OUT_DIR, "aura-sanctuary.blend")
GLB_OUT = os.path.join(OUT_DIR, "aura-sanctuary.glb")
PREVIEW_OUT = os.path.join(OUT_DIR, "aura-sanctuary-preview.png")

rng = np.random.default_rng(42)


def log(msg: str) -> None:
    print(f"[sanctuary] {msg}", flush=True)


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.fps = 24
    scene.world = bpy.data.worlds.new("DuskWorld")
    scene.world.use_nodes = True
    nt = scene.world.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs[0].default_value = (0.086, 0.11, 0.145, 1)
    bg.inputs[1].default_value = 0.55
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs[0], out.inputs[0])


def col(name: str, parent=None):
    c = bpy.data.collections.new(name)
    if parent is None:
        bpy.context.scene.collection.children.link(c)
    else:
        parent.children.link(c)
    return c


def smooth(obj):
    mesh = obj.data
    if hasattr(mesh, "polygons"):
        for p in mesh.polygons:
            p.use_smooth = True


def apply_mods(obj):
    if not obj.modifiers:
        return
    dg = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(dg)
    mesh = bpy.data.meshes.new_from_object(eval_obj)
    old = obj.data
    obj.modifiers.clear()
    obj.data = mesh
    if old.users == 0:
        bpy.data.meshes.remove(old)


def bevel(obj, width=0.006, segs=2, angle=40):
    m = obj.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segs
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle)
    m.affect = "EDGES"


def sock(node, *names):
    for n in names:
        s = node.inputs.get(n)
        if s is not None:
            return s
    return None


def set_in(node, value, *names):
    s = sock(node, *names)
    if s is None:
        return
    try:
        s.default_value = value
    except Exception:
        pass


def fbm(h, w, seed=0, octaves=5, freq=5.0):
    r = np.random.default_rng(seed)
    img = np.zeros((h, w), np.float32)
    amp = 0.55
    f = freq
    for _ in range(octaves):
        gh = int(f) + 4
        gw = int(f) + 4
        grid = r.random((gh, gw), dtype=np.float32)
        ys = np.linspace(0, f, h, endpoint=False)
        xs = np.linspace(0, f, w, endpoint=False)
        y0 = np.floor(ys).astype(np.int32)
        x0 = np.floor(xs).astype(np.int32)
        fy = ys - y0
        fx = xs - x0
        fy = fy * fy * (3 - 2 * fy)
        fx = fx * fx * (3 - 2 * fx)
        Y0 = y0[:, None]
        X0 = x0[None, :]
        v00 = grid[Y0, X0]
        v10 = grid[Y0 + 1, X0]
        v01 = grid[Y0, X0 + 1]
        v11 = grid[Y0 + 1, X0 + 1]
        fy2 = fy[:, None]
        fx2 = fx[None, :]
        v0 = v00 * (1 - fy2) + v10 * fy2
        v1 = v01 * (1 - fy2) + v11 * fy2
        img += amp * (v0 * (1 - fx2) + v1 * fx2)
        amp *= 0.5
        f *= 2.05
    m = float(img.max()) or 1.0
    return img / m


def make_image(name, rgb):
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(name, width=w, height=h, alpha=False)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.clip(rgb, 0.0, 1.0)
    img.pixels.foreach_set(rgba[::-1].reshape(-1))
    img.pack()
    return img


def wood_tex(name, base, accent, seed, rings=26, size=768):
    n = fbm(size, size, seed=seed, freq=6)
    n2 = fbm(size, size, seed=seed + 9, freq=18)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    u = xx / size
    v = yy / size
    g = np.sin((u * rings + n * 1.15 + v * 0.18) * math.pi * 2.0)
    g = 0.5 + 0.5 * g
    pores = (n2 > 0.78).astype(np.float32)
    col = np.zeros((size, size, 3), np.float32)
    base = np.array(base, np.float32)
    accent = np.array(accent, np.float32)
    mix = (0.78 + 0.22 * g) * (1.0 - 0.08 * pores)
    col[:] = base[None, None, :] * mix[..., None] + accent[None, None, :] * (0.10 * n[..., None])
    return make_image(name, col)


def grass_tex(size=768):
    n = fbm(size, size, seed=3, freq=8)
    n2 = fbm(size, size, seed=11, freq=28)
    a = np.array([0.18, 0.20, 0.12], np.float32)
    b = np.array([0.32, 0.34, 0.16], np.float32)
    dry = np.array([0.42, 0.38, 0.22], np.float32)
    col = a + (b - a) * n[..., None] + dry * (0.25 * n2[..., None])
    return make_image("GrassAlbedo", col)


def stone_tex(size=512):
    n = fbm(size, size, seed=21, freq=7)
    n2 = fbm(size, size, seed=22, freq=30)
    grey = 0.42 + 0.22 * n - 0.12 * (n2 > 0.65)
    col = np.stack([grey * 0.95, grey * 0.93, grey * 0.88], axis=-1)
    return make_image("StoneAlbedo", col)


def velvet_tex(size=768):
    n = fbm(size, size, seed=31, freq=10)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    tuft = 0.5 + 0.5 * np.cos(xx / size * math.pi * 10) * np.cos(yy / size * math.pi * 10)
    base = np.array([0.045, 0.18, 0.22], np.float32)
    hi = np.array([0.09, 0.32, 0.36], np.float32)
    col = base + (hi - base) * (0.35 * n + 0.4 * tuft)[..., None]
    buttons = ((tuft < 0.12) & (n < 0.55)).astype(np.float32)
    col *= (1.0 - 0.45 * buttons[..., None])
    return make_image("VelvetAlbedo", col)


def metal_tex(size=512):
    n = fbm(size, size, seed=41, freq=12)
    v = 0.035 + 0.04 * n
    col = np.stack([v, v * 1.02, v * 1.06], axis=-1)
    return make_image("MetalAlbedo", col)


def new_mat(name, color=(0.5, 0.5, 0.5, 1), metallic=0.0, roughness=0.5, img=None, emission=None, emission_strength=0.0, transmission=0.0, alpha=1.0, ior=1.45, scale=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (0, 0)
    out.location = (280, 0)
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    set_in(bsdf, color, "Base Color")
    set_in(bsdf, metallic, "Metallic")
    set_in(bsdf, roughness, "Roughness")
    set_in(bsdf, ior, "IOR")
    set_in(bsdf, alpha, "Alpha")
    set_in(bsdf, transmission, "Transmission Weight", "Transmission")
    if emission is not None:
        set_in(bsdf, (*emission[:3], 1), "Emission Color", "Emission")
        set_in(bsdf, emission_strength, "Emission Strength")
    if img is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.location = (-420, 40)
        mapping = nt.nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (scale, scale, scale)
        mapping.location = (-640, 40)
        coord = nt.nodes.new("ShaderNodeTexCoord")
        coord.location = (-860, 40)
        nt.links.new(coord.outputs["UV"], mapping.inputs["Vector"])
        nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
        nt.links.new(tex.outputs["Color"], sock(bsdf, "Base Color"))
    if alpha < 0.999 or transmission > 0.01:
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "BLENDED"
        else:
            mat.blend_method = "BLEND"
        mat.use_backface_culling = False
    return mat


def assign(obj, mat):
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)


def add_obj(name, mesh, loc, collection, mat=None, rot=(0, 0, 0)):
    obj = bpy.data.objects.new(name, mesh)
    obj.location = loc
    obj.rotation_euler = Euler(rot)
    collection.objects.link(obj)
    if mat:
        assign(obj, mat)
    return obj


def box_mesh(name, sx, sy, sz):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        n = f.normal
        for l in f.loops:
            c = l.vert.co
            if abs(n.z) >= abs(n.x) and abs(n.z) >= abs(n.y):
                l[uv].uv = (c.x * 0.55, c.y * 0.55)
            elif abs(n.y) >= abs(n.x):
                l[uv].uv = (c.x * 0.55, c.z * 0.55)
            else:
                l[uv].uv = (c.y * 0.55, c.z * 0.55)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return mesh


def cyl_mesh(name, radius, depth, segs=48, cap=True):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=radius, radius2=radius, depth=depth)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return mesh


def ico_mesh(name, radius, subs=2):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subs, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return mesh


def torus_mesh(name, major, minor, maj_seg=40, min_seg=10):
    verts = []
    faces = []
    for i in range(maj_seg):
        u = i / maj_seg * math.tau
        cu, su = math.cos(u), math.sin(u)
        for j in range(min_seg):
            v = j / min_seg * math.tau
            cv, sv = math.cos(v), math.sin(v)
            x = (major + minor * cv) * cu
            y = (major + minor * cv) * su
            z = minor * sv
            verts.append((x, y, z))
    for i in range(maj_seg):
        i2 = (i + 1) % maj_seg
        for j in range(min_seg):
            j2 = (j + 1) % min_seg
            a = i * min_seg + j
            b = i2 * min_seg + j
            c = i2 * min_seg + j2
            d = i * min_seg + j2
            faces.append((a, b, c, d))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    return mesh


def box(name, sx, sy, sz, loc, collection, mat, rot=(0, 0, 0), do_bevel=True, bevel_w=0.006):
    obj = add_obj(name, box_mesh(name + "Mesh", sx, sy, sz), loc, collection, mat, rot)
    if do_bevel:
        bevel(obj, bevel_w)
    smooth(obj)
    return obj


def cylinder(name, radius, depth, loc, collection, mat, rot=(0, 0, 0), segs=48):
    obj = add_obj(name, cyl_mesh(name + "Mesh", radius, depth, segs), loc, collection, mat, rot)
    smooth(obj)
    return obj


def empty(name, loc, collection, size=0.25):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_size = size
    obj.empty_display_type = "PLAIN_AXES"
    obj.location = loc
    collection.objects.link(obj)
    return obj


def parent(child, parent_obj):
    child.parent = parent_obj
    child.matrix_parent_inverse = parent_obj.matrix_world.inverted()


def arch_mesh(name, radius, tube, segs=48):
    """Standing circle in XZ, opening along Y."""
    mesh = torus_mesh(name, radius, tube, segs, 8)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return mesh


def make_materials():
    log("textures")
    oak_img = wood_tex("OakAlbedo", (0.52, 0.34, 0.17), (0.28, 0.16, 0.07), seed=1, rings=8)
    deck_img = wood_tex("DeckAlbedo", (0.09, 0.07, 0.055), (0.04, 0.03, 0.025), seed=2, rings=14)
    cedar_img = wood_tex("CedarAlbedo", (0.38, 0.24, 0.12), (0.18, 0.1, 0.05), seed=3, rings=9)
    grass_img = grass_tex()
    stone_img = stone_tex()
    velvet_img = velvet_tex()
    metal_img = metal_tex()

    mats = {
        "black_metal": new_mat("BlackMetal", (0.02, 0.021, 0.023, 1), metallic=0.92, roughness=0.28, img=metal_img, scale=3.2),
        "frame": new_mat("FrameMetal", (0.018, 0.018, 0.02, 1), metallic=0.88, roughness=0.32),
        "glass": new_mat("DarkGlass", (0.012, 0.016, 0.02, 1), metallic=0.18, roughness=0.055, transmission=0.08, alpha=0.82, ior=1.52),
        "oak": new_mat("Oak", (0.48, 0.3, 0.14, 1), roughness=0.55, img=oak_img, scale=1.35),
        "deck": new_mat("DeckWood", (0.07, 0.055, 0.04, 1), roughness=0.72, img=deck_img, scale=2.6),
        "cedar": new_mat("Cedar", (0.36, 0.22, 0.11, 1), roughness=0.62, img=cedar_img, scale=2.2),
        "velvet": new_mat("TealVelvet", (0.035, 0.22, 0.26, 1), roughness=0.84, img=velvet_img, scale=1.6),
        "velvet_gold": new_mat("GoldVelvet", (0.42, 0.34, 0.16, 1), roughness=0.78),
        "velvet_grey": new_mat("GreyVelvet", (0.22, 0.22, 0.23, 1), roughness=0.8),
        "fur": new_mat("FurThrow", (0.55, 0.52, 0.48, 1), roughness=0.9),
        "linen": new_mat("Linen", (0.62, 0.56, 0.46, 1), roughness=0.78),
        "stone": new_mat("RiverStone", (0.5, 0.48, 0.44, 1), roughness=0.88, img=stone_img, scale=1.4),
        "grass": new_mat("Meadow", (0.22, 0.24, 0.12, 1), roughness=0.95, img=grass_img, scale=18),
        "soil": new_mat("Soil", (0.16, 0.13, 0.08, 1), roughness=0.96),
        "water": new_mat("TubWater", (0.05, 0.07, 0.08, 1), roughness=0.04, transmission=0.55, alpha=0.55, ior=1.33),
        "chrome": new_mat("Chrome", (0.7, 0.72, 0.74, 1), metallic=1.0, roughness=0.12),
        "brass": new_mat("Brass", (0.62, 0.45, 0.16, 1), metallic=1.0, roughness=0.28),
        "led": new_mat("LEDViolet", (0.08, 0.04, 0.55, 1), roughness=0.25, emission=(0.22, 0.12, 1.0), emission_strength=6.5),
        "warm": new_mat("WarmLight", (1.0, 0.82, 0.55, 1), roughness=0.4, emission=(1.0, 0.78, 0.48), emission_strength=9.0),
        "fire": new_mat("FireGlow", (1.0, 0.38, 0.08, 1), roughness=0.4, emission=(1.0, 0.32, 0.05), emission_strength=22.0),
        "ember": new_mat("Ember", (0.9, 0.2, 0.04, 1), roughness=0.6, emission=(0.9, 0.18, 0.03), emission_strength=8.0),
        "chain": new_mat("ChainSteel", (0.08, 0.08, 0.09, 1), metallic=0.95, roughness=0.35),
        "rubber": new_mat("DarkRubber", (0.03, 0.03, 0.03, 1), roughness=0.7),
    }
    return mats


def build_ground(c, mats):
    log("ground")
    ground = cylinder("Meadow", 28.0, 0.08, (0, 2.0, -0.04), c, mats["grass"], segs=80)
    # slight dish so the LED reads against a darker under-plane
    under = cylinder("SoilDisk", 8.5, 0.04, (0.4, 2.2, -0.02), c, mats["soil"], segs=48)
    return ground, under


def build_cabin(c, mats):
    log("cabin")
    # Body: 6.4 x 3.05 x 2.48, floor at z=0.28, front at y=0
    W, D, H = 6.40, 3.05, 2.48
    wall = 0.07
    floor_z = 0.28
    cx, cy = 0.0, -D / 2.0
    zc = floor_z + H / 2.0

    shell = []
    # Floor
    shell.append(box("CabinFloor", W, D, 0.10, (cx, cy, floor_z + 0.05), c, mats["oak"], bevel_w=0.002))
    # Roof slab
    shell.append(box("CabinRoof", W + 0.06, D + 0.06, 0.12, (cx, cy, floor_z + H - 0.04), c, mats["black_metal"], bevel_w=0.004))
    # Roof vent
    shell.append(box("RoofVent", 0.55, 0.38, 0.08, (cx - 0.4, cy + 0.2, floor_z + H + 0.06), c, mats["black_metal"]))
    # Back wall
    shell.append(box("WallBack", W, wall, H - 0.16, (cx, cy - D / 2 + wall / 2, zc), c, mats["black_metal"]))
    # Side walls
    shell.append(box("WallLeft", wall, D, H - 0.16, (cx - W / 2 + wall / 2, cy, zc), c, mats["glass"]))
    shell.append(box("WallRight", wall, D, H - 0.16, (cx + W / 2 - wall / 2, cy, zc), c, mats["black_metal"]))
    # Standing-seam cladding on the long sides — matches the film's black metal body.
    for i in range(14):
        yy = cy - D / 2 + 0.12 + i * (D - 0.24) / 13
        box(f"SeamL_{i}", 0.016, 0.02, H - 0.30, (cx - W / 2 - 0.006, yy, zc), c, mats["frame"], do_bevel=False)
        box(f"SeamR_{i}", 0.016, 0.02, H - 0.30, (cx + W / 2 + 0.006, yy, zc), c, mats["frame"], do_bevel=False)

    # Interior lining (inset, oak)
    inset = 0.03
    box("LinerBack", W - 2 * wall - 0.02, 0.02, H - 0.28, (cx, cy - D / 2 + wall + 0.03, zc), c, mats["oak"], do_bevel=False)
    box("LinerLeft", 0.02, D - 2 * wall, H - 0.28, (cx - W / 2 + wall + 0.03, cy, zc), c, mats["oak"], do_bevel=False)
    box("LinerRight", 0.02, D - 2 * wall, H - 0.28, (cx + W / 2 - wall - 0.03, cy, zc), c, mats["oak"], do_bevel=False)
    box("LinerCeil", W - 2 * wall, D - 2 * wall, 0.02, (cx, cy, floor_z + H - 0.14), c, mats["oak"], do_bevel=False)

    # Front frame: 4 bays. Bay 1 (second from left) is OPEN.
    # x from -W/2 to W/2
    n_bays = 4
    post_w = 0.055
    inner_w = W - 2 * wall
    bay_w = (inner_w - post_w * (n_bays + 1)) / n_bays
    front_y = 0.0 - 0.01
    open_bay = 1
    glass_h = H - 0.28
    glass_z = floor_z + 0.12 + glass_h / 2

    # Header and sill
    box("FrontSill", W, 0.08, 0.10, (0, front_y, floor_z + 0.07), c, mats["frame"], bevel_w=0.003)
    box("FrontHead", W, 0.08, 0.12, (0, front_y, floor_z + H - 0.10), c, mats["frame"], bevel_w=0.003)

    x0 = -W / 2 + wall
    for i in range(n_bays + 1):
        px = x0 + i * (bay_w + post_w) + post_w / 2
        box(f"FrontPost_{i}", post_w, 0.08, glass_h, (px, front_y, glass_z), c, mats["frame"], do_bevel=False)

    for i in range(n_bays):
        bx = x0 + post_w + i * (bay_w + post_w) + bay_w / 2
        if i == open_bay:
            # Park the open slider over the neighbouring closed bay so the opening reads as a void.
            parked = box(
                "GlassSliderOpen",
                bay_w - 0.02,
                0.018,
                glass_h - 0.04,
                (bx - bay_w * 0.92, front_y + 0.03, glass_z),
                c,
                mats["glass"],
                do_bevel=False,
            )
            parked.visible_shadow = False
            continue
        g = box(f"Glass_{i}", bay_w - 0.02, 0.018, glass_h - 0.04, (bx, front_y + 0.01, glass_z), c, mats["glass"], do_bevel=False)
        g.visible_shadow = False

    # Interior kitchenette (left of opening) and sofa (right of opening)
    iz = floor_z + 0.10
    # Cabinet run along back-left
    box("Cabinet", 1.55, 0.52, 0.88, (-1.55, cy - 0.55, iz + 0.44), c, mats["oak"], bevel_w=0.004)
    box("Counter", 1.58, 0.54, 0.04, (-1.55, cy - 0.55, iz + 0.90), c, mats["oak"], bevel_w=0.002)
    # Sink
    sink = cylinder("Sink", 0.16, 0.08, (-1.35, cy - 0.42, iz + 0.94), c, mats["chrome"], rot=(0, 0, 0), segs=24)
    # Faucet
    cylinder("FaucetStem", 0.012, 0.22, (-1.35, cy - 0.62, iz + 1.04), c, mats["chrome"], segs=12)
    cylinder("FaucetSpout", 0.011, 0.16, (-1.35, cy - 0.54, iz + 1.14), c, mats["chrome"], rot=(math.pi / 2, 0, 0), segs=12)

    # Sofa
    box("SofaBase", 1.55, 0.72, 0.38, (0.85, cy - 0.35, iz + 0.19), c, mats["linen"], bevel_w=0.01)
    box("SofaBack", 1.55, 0.16, 0.52, (0.85, cy - 0.66, iz + 0.52), c, mats["linen"], bevel_w=0.01)
    box("SofaArmL", 0.12, 0.72, 0.46, (0.12, cy - 0.35, iz + 0.41), c, mats["linen"], bevel_w=0.01)
    box("SofaArmR", 0.12, 0.72, 0.46, (1.58, cy - 0.35, iz + 0.41), c, mats["linen"], bevel_w=0.01)
    box("SeatCush", 1.28, 0.58, 0.10, (0.85, cy - 0.30, iz + 0.42), c, mats["linen"], bevel_w=0.012)

    # Cove light along back wall
    box("CoveLight", 5.4, 0.04, 0.03, (0.0, cy - D / 2 + 0.14, floor_z + H - 0.32), c, mats["warm"], do_bevel=False)
    cylinder("Downlight_0", 0.045, 0.02, (-1.1, cy, floor_z + H - 0.16), c, mats["warm"], segs=16)
    cylinder("Downlight_1", 0.045, 0.02, (1.15, cy, floor_z + H - 0.16), c, mats["warm"], segs=16)

    # Exterior sconce over right corner
    cylinder("Sconce", 0.04, 0.05, (2.85, 0.06, floor_z + H - 0.22), c, mats["warm"], segs=12)

    # Hanging side table on right front
    tab = box("SideTable", 0.55, 0.38, 0.09, (2.72, 0.42, 0.92), c, mats["deck"], bevel_w=0.004)
    cylinder("Candle", 0.035, 0.05, (2.72, 0.42, 0.99), c, mats["warm"], segs=12)
    # two drop cables
    cylinder("TableCable_0", 0.006, 1.55, (2.55, 0.28, 1.72), c, mats["chain"], segs=8)
    cylinder("TableCable_1", 0.006, 1.55, (2.90, 0.28, 1.72), c, mats["chain"], segs=8)

    # Left planter
    cylinder("Planter", 0.28, 0.42, (-3.45, 0.55, 0.48), c, mats["black_metal"], segs=20)

    return {
        "front_y": front_y,
        "floor_z": floor_z,
        "W": W,
        "D": D,
        "H": H,
        "open_x": x0 + post_w + open_bay * (bay_w + post_w) + bay_w / 2,
    }


def build_deck(c, mats, cabin):
    log("deck")
    W = cabin["W"] + 0.18
    depth = 2.72
    thick = 0.11
    top = cabin["floor_z"]
    y0 = 0.06
    yc = y0 + depth / 2
    # subframe
    box("DeckSub", W, depth, thick, (0.05, yc, top - thick / 2), c, mats["deck"], do_bevel=False)

    # boards running out from the cabin (Y)
    n = 22
    bw = (W - 0.08) / n
    for i in range(n):
        x = -W / 2 + 0.04 + i * bw + bw / 2
        gap = 0.008
        box(f"DeckBoard_{i}", bw - gap, depth - 0.04, 0.025, (x, yc, top + 0.01), c, mats["deck"], do_bevel=False)

    # LED strip under perimeter — four thin emissive bars
    led_z = top - thick - 0.02
    box("LED_Front", W - 0.1, 0.04, 0.03, (0.05, y0 + depth - 0.04, led_z), c, mats["led"], do_bevel=False)
    box("LED_Back", W - 0.1, 0.04, 0.03, (0.05, y0 + 0.06, led_z), c, mats["led"], do_bevel=False)
    box("LED_L", 0.04, depth - 0.12, 0.03, (-W / 2 + 0.08, yc, led_z), c, mats["led"], do_bevel=False)
    box("LED_R", 0.04, depth - 0.12, 0.03, (W / 2 + 0.02, yc, led_z), c, mats["led"], do_bevel=False)

    # River stones along the cabin wall
    log("stones")
    band_y = 0.18
    for i in range(52):
        x = -W / 2 + 0.25 + (W - 0.5) * (i / 51) + float(rng.normal(0, 0.04))
        y = band_y + float(rng.normal(0, 0.07))
        s = 0.07 + float(rng.random()) * 0.09
        z = top + s * 0.35
        obj = add_obj(f"Stone_{i}", ico_mesh(f"StoneMesh_{i}", s, 1), (x, y, z), c, mats["stone"])
        obj.rotation_euler = Euler((float(rng.random()) * 0.8, float(rng.random()) * 0.8, float(rng.random()) * 3))
        obj.scale = Vector((1.0, 0.75 + float(rng.random()) * 0.4, 0.55 + float(rng.random()) * 0.35))
        smooth(obj)

    return {"W": W, "depth": depth, "top": top, "yc": yc}


def build_nest(c, mats):
    log("nest")
    radius = 1.72
    tube = 0.08
    ax, ay = 4.95, 2.20
    az = radius
    arch = add_obj("Arch", arch_mesh("ArchMesh", radius, tube, 64), (ax, ay, az), c, mats["black_metal"])
    arch.rotation_euler = Euler((0, 0, math.radians(-10)))
    smooth(arch)

    rim = add_obj("ArchRim", arch_mesh("ArchRimMesh", radius - 0.018, 0.012, 48), (ax, ay, az), c, mats["frame"])
    rim.rotation_euler = arch.rotation_euler.copy()
    smooth(rim)

    # Pivot at the crown. Daybed lives in local space so the swing is a single rotation.
    pivot = empty("SwingPivot", (ax, ay, az + radius - 0.10), c, 0.25)
    hang = -2.48
    bed = empty("Daybed", (0.0, 0.0, hang), c, 0.15)
    bed.parent = pivot

    bed_r = 1.02
    ring = add_obj("DaybedRing", torus_mesh("DaybedRingMesh", bed_r, 0.048, 56, 8), (0, 0, 0), c, mats["black_metal"])
    ring.parent = bed
    smooth(ring)

    cush_mesh = bpy.data.meshes.new("CushionMesh")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=56, radius1=bed_r - 0.02, radius2=bed_r - 0.07, depth=0.18)
    for v in bm.verts:
        r = math.hypot(v.co.x, v.co.y)
        if v.co.z > 0 and r < bed_r * 0.9:
            tuft = 0.016 * math.cos(v.co.x * 6.8) * math.cos(v.co.y * 6.8)
            dome = 0.055 * (1.0 - (r / (bed_r + 1e-4)) ** 2)
            v.co.z += dome + tuft
    bm.to_mesh(cush_mesh)
    bm.free()
    cushion = add_obj("DaybedCushion", cush_mesh, (0, 0, 0.07), c, mats["velvet"])
    cushion.parent = bed
    smooth(cushion)

    attach = [(-0.58, -0.58), (0.58, -0.58), (-0.58, 0.58), (0.58, 0.58)]
    for i, (dx, dy) in enumerate(attach):
        a = Vector((dx * 0.18, dy * 0.14, -0.04))  # near pivot, local
        b = Vector((dx, dy, hang + 0.18))
        mid = (a + b) / 2
        vec = b - a
        cable = cylinder(f"Chain_{i}", 0.012, vec.length, tuple(mid), c, mats["chain"], segs=8)
        cable.parent = pivot
        cable.location = mid
        quat = Vector((0, 0, 1)).rotation_difference(vec.normalized())
        cable.rotation_euler = quat.to_euler()
        for k in range(6):
            t = 0.06 + k * 0.06
            p = a.lerp(b, t)
            link = add_obj(f"Link_{i}_{k}", torus_mesh(f"LinkMesh_{i}_{k}", 0.026, 0.007, 10, 6), tuple(p), c, mats["chain"])
            link.parent = pivot
            link.location = p
            link.rotation_euler = Euler((math.pi / 2 if k % 2 == 0 else 0.15, 0.0, float(k)))

    for i in range(10):
        a = i / 10 * math.pi * 2
        bol = cylinder(
            f"Bolster_{i}",
            0.115,
            0.36,
            (math.cos(a) * (bed_r - 0.17), math.sin(a) * (bed_r - 0.17), 0.22),
            c,
            mats["velvet"],
            rot=(math.pi / 2, 0, a),
            segs=16,
        )
        bol.parent = bed
        bol.location = (math.cos(a) * (bed_r - 0.17), math.sin(a) * (bed_r - 0.17), 0.22)

    pillows = [
        ("PillowGreyA", mats["velvet_grey"], (-0.12, 0.18, 0.28), (0.12, 0.2, 0.35)),
        ("PillowGreyB", mats["velvet_grey"], (0.22, 0.08, 0.30), (0.2, -0.3, 0.5)),
        ("PillowGold", mats["velvet_gold"], (0.42, -0.15, 0.28), (0.15, 0.4, -0.4)),
        ("PillowTeal", mats["velvet"], (-0.48, -0.05, 0.32), (0.1, -0.2, 0.6)),
    ]
    for name, mat, loc, rot in pillows:
        p = box(name, 0.38, 0.38, 0.12, loc, c, mat, rot=rot, bevel_w=0.02)
        p.parent = bed
        p.location = loc
        p.rotation_euler = Euler(rot)

    throw = add_obj("FurThrow", ico_mesh("ThrowMesh", 0.42, 2), (0.38, -0.48, 0.22), c, mats["fur"])
    throw.scale = Vector((1.4, 0.95, 0.13))
    throw.rotation_euler = Euler((0.4, 0.18, 0.85))
    throw.parent = bed
    throw.location = (0.38, -0.48, 0.22)

    cylinder("WineTableTop", 0.18, 0.03, (6.42, 2.62, 0.62), c, mats["black_metal"], segs=20)
    cylinder("WineTableStem", 0.018, 0.58, (6.42, 2.62, 0.32), c, mats["black_metal"], segs=10)
    cylinder("Bottle", 0.035, 0.28, (6.47, 2.65, 0.78), c, mats["black_metal"], segs=12)
    cylinder("GlassA", 0.028, 0.12, (6.34, 2.54, 0.70), c, mats["glass"], segs=10)
    cylinder("GlassB", 0.028, 0.12, (6.28, 2.64, 0.70), c, mats["glass"], segs=10)
    return pivot


def build_tub(c, mats):
    log("tub")
    tx, ty = -1.15, 5.55
    # platform
    box("TubDeck", 2.35, 2.15, 0.10, (tx, ty, 0.06), c, mats["deck"], bevel_w=0.003)
    n = 10
    bw = 2.35 / n
    for i in range(n):
        box(f"TubBoard_{i}", bw - 0.008, 2.12, 0.02, (tx - 1.175 + i * bw + bw / 2, ty, 0.12), c, mats["deck"], do_bevel=False)

    # stave barrel
    tub_r, tub_h = 0.78, 0.92
    tub = cylinder("HotTub", tub_r, tub_h, (tx - 0.15, ty - 0.05, 0.12 + tub_h / 2), c, mats["cedar"], segs=48)
    for i in range(18):
        a = i / 18 * math.tau
        sx = (tx - 0.15) + math.cos(a) * (tub_r + 0.008)
        sy = (ty - 0.05) + math.sin(a) * (tub_r + 0.008)
        box(f"Stave_{i}", 0.085, 0.018, tub_h - 0.06, (sx, sy, 0.12 + tub_h / 2), c, mats["cedar"], rot=(0, 0, a), do_bevel=False)
    # inner water
    water = cylinder("TubWater", tub_r - 0.05, 0.08, (tx - 0.15, ty - 0.05, 0.12 + tub_h - 0.14), c, mats["water"], segs=32)
    water.visible_shadow = False
    # metal bands
    cylinder("BandLow", tub_r + 0.01, 0.035, (tx - 0.15, ty - 0.05, 0.28), c, mats["chrome"], segs=36)
    cylinder("BandHigh", tub_r + 0.01, 0.035, (tx - 0.15, ty - 0.05, 0.88), c, mats["chrome"], segs=36)

    # stove
    stove = box("Stove", 0.42, 0.36, 0.46, (tx - 0.95, ty - 0.05, 0.42), c, mats["black_metal"], bevel_w=0.008)
    box("StoveDoor", 0.22, 0.02, 0.22, (tx - 0.95, ty + 0.19, 0.36), c, mats["ember"], do_bevel=False)
    box("FirePlane", 0.16, 0.01, 0.16, (tx - 0.95, ty + 0.20, 0.36), c, mats["fire"], do_bevel=False)
    # chimney
    cylinder("Chimney", 0.055, 0.85, (tx - 0.95, ty - 0.05, 1.08), c, mats["chrome"], segs=16)
    cylinder("ChimneyCap", 0.07, 0.04, (tx - 0.95, ty - 0.05, 1.52), c, mats["chrome"], segs=16)
    box("HeatShield", 0.28, 0.22, 0.08, (tx - 0.55, ty - 0.05, 0.95), c, mats["chrome"], bevel_w=0.004)

    # firewood
    for i, (dx, dy, rz) in enumerate(((-0.15, 0.85, 0.4), (0.05, 0.92, -0.3), (-0.02, 0.78, 1.1), (0.18, 0.84, 0.2))):
        log_obj = cylinder(f"Firewood_{i}", 0.07, 0.42, (tx + 0.95 + dx, ty + dy, 0.22), c, mats["cedar"], rot=(math.pi / 2, 0, rz), segs=10)
        log_obj.scale = Vector((1, 1, 0.9 + i * 0.04))

    # brass faucet on platform
    cylinder("TubFaucet", 0.03, 0.04, (tx - 0.85, ty + 0.85, 0.16), c, mats["brass"], segs=12)
    return (tx, ty, 0.55)


def build_hills(c, mats):
    log("hills")
    hill_mat = new_mat("Hill", (0.055, 0.07, 0.048, 1), roughness=0.98)
    # Behind the cabin (negative Y in Blender → +Z in glTF) so dusk cameras see a ridgeline.
    specs = [
        (-18, -20, 16, 7, 3.4),
        (4, -26, 22, 9, 5.2),
        (20, -16, 12, 6, 3.0),
        (-30, -10, 14, 8, 3.8),
        (14, -32, 18, 8, 4.4),
    ]
    for i, (x, y, sx, sy, sz) in enumerate(specs):
        obj = add_obj(f"Hill_{i}", ico_mesh(f"HillMesh_{i}", 1.0, 2), (x, y, sz * 0.28), c, hill_mat)
        obj.scale = Vector((sx, sy, sz))
        smooth(obj)


def build_targets(c):
    t = col("Targets")
    empty("Target_Tub", (-1.15, 5.55, 0.55), t)
    empty("Target_Deck", (0.2, 1.6, 0.9), t)
    empty("Target_Nest", (4.95, 2.15, 1.15), t)
    empty("Target_Interior", (0.0, -1.2, 1.35), t)
    empty("Target_Hero", (1.6, 2.4, 1.15), t)
    empty("CamStart", (-0.2, 8.4, 1.25), t)
    empty("CamHero", (7.2, 9.8, 3.4), t)


def build_lights():
    log("lights")
    sun = bpy.data.lights.new("DuskSun", "SUN")
    sun.energy = 2.4
    sun.color = (0.55, 0.62, 0.85)
    sun.angle = math.radians(8)
    sun_obj = bpy.data.objects.new("DuskSun", sun)
    sun_obj.rotation_euler = Euler((math.radians(58), math.radians(-18), math.radians(40)))
    bpy.context.scene.collection.objects.link(sun_obj)

    def point(name, loc, color, energy, dist=8.0):
        lamp = bpy.data.lights.new(name, "POINT")
        lamp.energy = energy
        lamp.color = color
        lamp.shadow_soft_size = 0.18
        obj = bpy.data.objects.new(name, lamp)
        obj.location = loc
        bpy.context.scene.collection.objects.link(obj)
        return obj

    point("LightInterior", (0.0, -1.4, 1.7), (1.0, 0.78, 0.5), 90, 6)
    point("LightCove", (0.0, -2.6, 2.2), (1.0, 0.8, 0.52), 40, 4)
    point("LightLED", (0.2, 1.8, 0.12), (0.35, 0.25, 1.0), 28, 5)
    point("LightFire", (-2.1, 5.5, 0.45), (1.0, 0.38, 0.08), 35, 3)
    point("LightNest", (4.95, 2.15, 2.4), (1.0, 0.85, 0.7), 18, 4)


def preview_camera():
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 35
    cam_data.dof.use_dof = False
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    cam.location = (1.15, 8.9, 1.55)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    loc = Vector(cam.location)
    target = Vector((1.8, 1.35, 1.15))
    direction = target - loc
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_preview():
    log("preview render")
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 900
    scene.render.filepath = PREVIEW_OUT
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    ee = scene.eevee
    if hasattr(ee, "use_shadows"):
        ee.use_shadows = True
    try:
        bpy.ops.render.render(write_still=True)
        log(f"preview -> {PREVIEW_OUT}")
    except Exception as exc:
        log(f"preview skipped: {exc}")


def export_glb():
    log("export glb")
    os.makedirs(OUT_DIR, exist_ok=True)
    # Apply remaining modifiers
    for obj in list(bpy.data.objects):
        if obj.type == "MESH":
            try:
                apply_mods(obj)
            except Exception:
                pass
    kwargs = dict(
        filepath=GLB_OUT,
        export_format="GLB",
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_extras=True,
        export_yup=True,
        export_image_format="JPEG",
        export_jpeg_quality=86,
    )
    # lights + punctual if the operator supports them
    op = bpy.ops.export_scene.gltf
    rna = bpy.ops.export_scene.gltf.get_rna_type() if hasattr(bpy.ops.export_scene.gltf, "get_rna_type") else None
    try:
        kwargs["export_lights"] = True
    except Exception:
        pass
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        # drop unknown keys
        safe = {
            "filepath": GLB_OUT,
            "export_format": "GLB",
            "export_apply": True,
            "export_cameras": False,
            "export_yup": True,
        }
        bpy.ops.export_scene.gltf(**safe)
    log(f"glb -> {GLB_OUT}")
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    log(f"blend -> {BLEND_OUT}")


def main():
    reset_scene()
    # fix accidental indent bug if any — rebuild collections
    root = bpy.context.scene.collection
    mats = make_materials()
    ground_c = col("Ground")
    cabin_c = col("Cabin")
    deck_c = col("Deck")
    nest_c = col("Nest")
    tub_c = col("HotTub")
    hill_c = col("Hills")
    build_ground(ground_c, mats)
    cabin = build_cabin(cabin_c, mats)
    build_deck(deck_c, mats, cabin)
    build_nest(nest_c, mats)
    build_tub(tub_c, mats)
    build_hills(hill_c, mats)
    build_targets(None)
    build_lights()
    preview_camera()
    tris = 0
    meshes = 0
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.data:
            meshes += 1
            obj.data.calc_loop_triangles()
            tris += len(obj.data.loop_triangles)
    log(f"meshes={meshes} tris={tris}")
    export_glb()
    log("done")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
