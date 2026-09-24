import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { computeLayout } from '../core/layout.js';
import { languageColor } from '../core/languages.js';

export const TOUCH_COLORS = {
  read: [0.25, 0.75, 1.0],
  search: [0.7, 0.45, 1.0],
  write: [1.0, 0.5, 0.12],
  create: [0.35, 1.0, 0.45],
  delete: [1.0, 0.2, 0.25],
};

const STAR_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aBirth;
  attribute vec3 aGlow;
  attribute float aDim;
  uniform float uReveal;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float born = step(aBirth, uReveal);
    float fresh = born * (1.0 - smoothstep(0.0, 0.015, uReveal - aBirth)) * step(uReveal, 0.9999);
    float glow = max(max(aGlow.r, aGlow.g), aGlow.b);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float twinkle = 0.82 + 0.18 * sin(uTime * 1.7 + position.x * 13.1 + position.z * 7.3);
    gl_PointSize = aSize * (1.0 + fresh * 1.3 + glow * 2.2) * uPixelRatio * (260.0 / -mv.z);
    vColor = mix(aColor, vec3(1.0), fresh * 0.35) + aGlow;
    vAlpha = born * mix(1.0, 0.06, aDim) * mix(twinkle, 1.0, min(glow, 1.0));
    gl_Position = projectionMatrix * mv;
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = exp(-d * d * 7.0);
    float halo = exp(-d * 3.2) * 0.35;
    float a = (core + halo) * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

const DUST_VERTEX = /* glsl */ `
  attribute float aTint;
  uniform float uPixelRatio;
  uniform float uReveal;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = (aTint > 0.5 ? 7.0 : 9.0) * uPixelRatio * (160.0 / -mv.z);
    vColor = (aTint > 0.5 ? vec3(1.0, 0.78, 0.55) * 0.07 : vec3(0.35, 0.45, 1.0) * 0.045) * (0.2 + 0.8 * uReveal);
    gl_Position = projectionMatrix * mv;
  }
`;

const DUST_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = exp(-d * d * 4.0);
    gl_FragColor = vec4(vColor * a, a);
  }
`;

export class Galaxy {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
    this.camera.position.set(0, 95, 175);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 700;
    this.controls.addEventListener('start', () => (this.controls.autoRotate = false));

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.45, 0.12);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.uniforms = {
      uReveal: { value: 1 },
      uTime: { value: 0 },
      uPixelRatio: { value: this.renderer.getPixelRatio() },
    };

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(2, 2);
    this.hovered = -1;
    this.listeners = { hover: [], click: [], frame: [] };
    this.active = new Set(); // indices with glow > 0
    this.trail = [];
    this.flight = null;
    this.labels = [];

    this.addBackdrop();
    this.addTrail();
    this.bindEvents();
    this.resize();
    this.timer = new THREE.Timer();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  on(event, cb) {
    this.listeners[event].push(cb);
  }

  emit(event, ...args) {
    for (const cb of this.listeners[event]) cb(...args);
  }

  addBackdrop() {
    const n = 2500;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 900 + Math.random() * 1200;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)], i * 3);
      const c = 0.12 + Math.random() ** 3 * 0.5;
      col.set([c * 0.85, c * 0.9, c], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false });
    this.scene.add(new THREE.Points(geo, mat));
  }

  addTrail() {
    this.trailMax = 24;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.trailMax * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.trailMax * 3), 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.trailLine = new THREE.Line(geo, mat);
    this.trailLine.frustumCulled = false;
    this.scene.add(this.trailLine);
  }

  /** Replaces the displayed galaxy. `galaxy` comes from buildGalaxy(). */
  setGalaxy(galaxy) {
    this.galaxy = galaxy;
    const { files, stats } = galaxy;
    const layout = computeLayout(files);
    this.layout = layout;
    const n = files.length;

    const colors = new Float32Array(n * 3);
    const births = new Float32Array(n);
    const [t0, t1] = stats.timeRange || [0, 0];
    const span = Math.max(1, t1 - t0);
    const tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      tmp.set(languageColor(files[i].lang)).convertSRGBToLinear();
      colors.set([tmp.r, tmp.g, tmp.b], i * 3);
      births[i] = files[i].time ? Math.min(0.999, (files[i].time - t0) / span) : 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(layout.positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(layout.sizes, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aBirth', new THREE.BufferAttribute(births, 1));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aDim', new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.computeBoundingSphere();

    if (this.dust) {
      this.scene.remove(this.dust);
      this.dust.geometry.dispose();
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(layout.dust.positions, 3));
    dustGeo.setAttribute('aTint', new THREE.BufferAttribute(layout.dust.tints, 1));
    this.dustMaterial ??= new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: this.uniforms.uPixelRatio, uReveal: this.uniforms.uReveal },
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(dustGeo, this.dustMaterial);
    this.scene.add(this.dust);

    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
    } else {
      this.material = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: STAR_VERTEX,
        fragmentShader: STAR_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
    }
    this.points = new THREE.Points(geo, this.material);
    this.scene.add(this.points);
    this.active.clear();
    this.trail = [];
    this.trailLine.geometry.setDrawRange(0, 0);
    this.raycaster.params.Points.threshold = 1.1;
  }

  /** 0..1 — only stars born before this point of the timeline are visible. */
  setReveal(v) {
    this.uniforms.uReveal.value = v;
  }

  /** Dims every star for which `keep(file)` is false; pass null to clear. */
  setFilter(keep) {
    const dim = this.points.geometry.attributes.aDim;
    const { files } = this.galaxy;
    for (let i = 0; i < files.length; i++) dim.array[i] = keep && !keep(files[i]) ? 1 : 0;
    dim.needsUpdate = true;
  }

  /** Lights up a star (live agent view) and extends the agent's trail to it. */
  touch(index, kind = 'read') {
    const glow = this.points.geometry.attributes.aGlow;
    const [r, g, b] = TOUCH_COLORS[kind] || TOUCH_COLORS.read;
    const k = 1.6;
    glow.array.set([r * k, g * k, b * k], index * 3);
    glow.needsUpdate = true;
    this.active.add(index);

    const p = this.layout.positions;
    this.trail.push({ pos: [p[index * 3], p[index * 3 + 1], p[index * 3 + 2]], color: [r, g, b] });
    if (this.trail.length > this.trailMax) this.trail.shift();
    this.updateTrail();
  }

  updateTrail() {
    const geo = this.trailLine.geometry;
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    const n = this.trail.length;
    this.trail.forEach((t, i) => {
      const fade = ((i + 1) / n) ** 1.5 * 0.9;
      pos.array.set(t.pos, i * 3);
      col.array.set(t.color.map((c) => c * fade), i * 3);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geo.setDrawRange(0, n);
  }

  positionOf(index) {
    const p = this.layout.positions;
    return new THREE.Vector3(p[index * 3], p[index * 3 + 1], p[index * 3 + 2]);
  }

  /** Smoothly flies the camera to look at a star. */
  focus(index, distance = 28) {
    const target = this.positionOf(index);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.flyTo(target, target.clone().add(dir.multiplyScalar(distance)));
  }

  flyTo(target, position) {
    this.controls.autoRotate = false;
    this.flight = {
      t: 0,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      fromPos: this.camera.position.clone(),
      toPos: position,
    };
  }

  resetView() {
    // Portrait screens need to back off so the whole disc fits horizontally.
    const k = this.camera.aspect < 1 ? Math.min(2.2, 0.85 / this.camera.aspect) : 1;
    this.flyTo(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 95 * k, 175 * k));
  }

  /** Returns a PNG data URL of the current view. */
  screenshot() {
    this.composer.render();
    return this.renderer.domElement.toDataURL('image/png');
  }

  bindEvents() {
    const el = this.renderer.domElement;
    window.addEventListener('resize', () => this.resize());
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.pointerPx = [e.clientX, e.clientY];
      this.needsPick = true;
    });
    el.addEventListener('pointerleave', () => {
      this.pointer.set(2, 2);
      this.needsPick = true;
    });
    let down = null;
    el.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      this.pick();
      if (this.hovered >= 0) this.emit('click', this.galaxy.files[this.hovered], this.hovered);
    });
  }

  pick() {
    if (!this.points) return;
    this.needsPick = false;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.raycaster.params.Points.threshold = Math.max(0.3, dist / 160);
    const hits = this.raycaster.intersectObject(this.points);
    const reveal = this.uniforms.uReveal.value;
    const births = this.points.geometry.attributes.aBirth.array;
    const dims = this.points.geometry.attributes.aDim.array;
    let best = -1;
    for (const h of hits) {
      if (births[h.index] > reveal || dims[h.index] > 0.5) continue;
      best = h.index;
      break;
    }
    if (best !== this.hovered) {
      this.hovered = best;
      this.renderer.domElement.style.cursor = best >= 0 ? 'pointer' : '';
    }
    this.emit('hover', best >= 0 ? this.galaxy.files[best] : null, this.pointerPx);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
  }

  frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.uniforms.uTime.value += dt;

    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / 1.2);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      this.camera.position.lerpVectors(f.fromPos, f.toPos, e);
      if (f.t >= 1) this.flight = null;
    }

    if (this.active.size) {
      const glow = this.points.geometry.attributes.aGlow;
      const decay = Math.pow(0.6, dt); // ~ halves every 1.4 s
      for (const i of this.active) {
        const o = i * 3;
        glow.array[o] *= decay;
        glow.array[o + 1] *= decay;
        glow.array[o + 2] *= decay;
        if (glow.array[o] + glow.array[o + 1] + glow.array[o + 2] < 0.03) {
          glow.array[o] = glow.array[o + 1] = glow.array[o + 2] = 0;
          this.active.delete(i);
        }
      }
      glow.needsUpdate = true;
    }

    this.controls.update();
    if (this.needsPick) this.pick();
    this.composer.render();
    this.emit('frame');
  }

  /** Projects a world position to screen pixels (or null if behind camera). */
  project(pos) {
    const v = new THREE.Vector3(...pos).project(this.camera);
    if (v.z > 1) return null;
    const el = this.renderer.domElement;
    return [((v.x + 1) / 2) * el.clientWidth, ((1 - v.y) / 2) * el.clientHeight];
  }
}
