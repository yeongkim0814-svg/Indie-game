import * as THREE from "three";

/**
 * Low-resolution render → "painted pixel" post:
 *  1. Kuwahara filter on the low-res buffer: merges pixels into flat clusters with
 *     crisp edges. Its radius grows with nearness, so foreground clusters are big
 *     and distant ones small, as in the reference.
 *  2. Tone map, then step luminance (keeping hue) and shift hue: shadows toward
 *     blue, highlights toward warm.
 * scale = 1 is the plain smooth render (comparison mode).
 */
export function createPixelPipeline(renderer: THREE.WebGLRenderer) {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  target.depthTexture = new THREE.DepthTexture(1, 1);
  const uniforms = {
    tScene: { value: target.texture },
    tDepth: { value: target.depthTexture },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.5 },
    uFar: { value: 3200 },
    uStyle: { value: 1 },
  };
  const post = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene, tDepth;
        uniform vec2 uTexel;
        uniform float uNear, uFar, uStyle;
        varying vec2 vUv;
        vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
        vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
        float linearDepth(float d) {
          float z = d * 2.0 - 1.0;
          return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
        }
        // 4-quadrant Kuwahara; radius 1..3 (texels) chosen per pixel from depth
        vec3 kuwahara(vec2 uv, int r) {
          vec3 m[4]; vec3 s[4];
          for (int k = 0; k < 4; k++) { m[k] = vec3(0.0); s[k] = vec3(0.0); }
          float n = float((r + 1) * (r + 1));
          for (int j = -3; j <= 3; j++) {
            for (int i = -3; i <= 3; i++) {
              if (abs(i) > r || abs(j) > r) continue;
              vec3 c = texture2D(tScene, uv + vec2(float(i), float(j)) * uTexel).rgb;
              c = c / (1.0 + c); // compress HDR so a bright sun texel doesn't dominate
              vec3 c2 = c * c;
              if (i <= 0 && j <= 0) { m[0] += c; s[0] += c2; }
              if (i >= 0 && j <= 0) { m[1] += c; s[1] += c2; }
              if (i <= 0 && j >= 0) { m[2] += c; s[2] += c2; }
              if (i >= 0 && j >= 0) { m[3] += c; s[3] += c2; }
            }
          }
          float best = 1e9; vec3 outc = vec3(0.0);
          for (int k = 0; k < 4; k++) {
            vec3 mu = m[k] / n;
            vec3 v = abs(s[k] / n - mu * mu);
            float sv = v.r + v.g + v.b;
            if (sv < best) { best = sv; outc = mu; }
          }
          return outc / max(1.0 - outc, 1e-3); // undo compression
        }
        void main() {
          vec3 c;
          if (uStyle > 0.5) {
            float dist = linearDepth(texture2D(tDepth, vUv).r);
            int r = dist < 30.0 ? 3 : dist < 140.0 ? 2 : 1;
            c = kuwahara(vUv, r);
            // keep isolated bright specks (flowers, glints) that the cluster filter would average away
            vec3 center = texture2D(tScene, vUv).rgb;
            float lc = dot(center, vec3(0.2126, 0.7152, 0.0722)), lk = dot(c, vec3(0.2126, 0.7152, 0.0722));
            if (lc > lk * 1.8 + 0.15) c = center;
          } else {
            c = texture2D(tScene, vUv).rgb;
          }
          c = toSrgb(aces(c * 0.9));
          if (uStyle > 0.5) {
            float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
            float Lq = floor(L * 11.0 + 0.5) / 11.0;
            c *= Lq / max(L, 1e-3);
            // hue shift: cool shadows, warm light
            c *= mix(vec3(0.80, 0.93, 1.16), vec3(1.0), smoothstep(0.08, 0.55, Lq));
            float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
            // warm only colored highlights (sunlit grass); white clouds stay white
            c = mix(c, c * vec3(1.05, 1.03, 0.93), smoothstep(0.55, 0.9, Lq) * smoothstep(0.08, 0.25, sat));
            float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
            c = clamp(mix(vec3(g), c, 1.12), 0.0, 1.0);
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  post.frustumCulled = false;
  const postScene = new THREE.Scene();
  postScene.add(post);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let scale = 4;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio, 3);
    const w = window.innerWidth, h = window.innerHeight;
    // pixel scale is in device pixels, so a "pixel" looks the same size on phone and tablet
    const div = scale === 1 ? Math.max(1, dpr / 1.6) : scale * dpr * 0.5;
    const tw = Math.max(1, Math.round((w * dpr) / div)), th = Math.max(1, Math.round((h * dpr) / div));
    target.setSize(tw, th);
    uniforms.uTexel.value.set(1 / tw, 1 / th);
    uniforms.uStyle.value = scale === 1 ? 0 : 1;
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    return { tw, th };
  }

  return {
    get scale() { return scale; },
    setScale(s: number) { scale = s; return resize(); },
    resize,
    render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
      uniforms.uNear.value = camera.near;
      uniforms.uFar.value = camera.far;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);
    },
  };
}
