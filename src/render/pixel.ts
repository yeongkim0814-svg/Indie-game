import * as THREE from "three";

/**
 * Renders the 3D scene into a low-resolution HDR target, then upscales with
 * nearest filtering: tone map → sRGB → ordered dither → limited color levels.
 * scale = 1 is the plain smooth render (comparison mode).
 */
export function createPixelPipeline(renderer: THREE.WebGLRenderer) {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  const uniforms = {
    tScene: { value: target.texture },
    uRes: { value: new THREE.Vector2(1, 1) },
    uLevels: { value: 20 },
    uDither: { value: 1 },
  };
  const post = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform vec2 uRes;
        uniform float uLevels, uDither;
        varying vec2 vUv;
        vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
        vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
        float bayer4(vec2 p) {
          int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
          int i = x + y * 4;
          int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
          return (float(m[i]) + 0.5) / 16.0 - 0.5;
        }
        void main() {
          vec3 c = texture2D(tScene, vUv).rgb;
          c = toSrgb(aces(c * 0.9));
          if (uLevels > 0.0) {
            vec2 px = floor(vUv * uRes);
            c += bayer4(px) * uDither / uLevels;
            c = floor(c * uLevels + 0.5) / uLevels;
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  post.frustumCulled = false;
  const postScene = new THREE.Scene();
  postScene.add(post);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let scale = 3;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio, 3);
    const w = window.innerWidth, h = window.innerHeight;
    // pixel scale is in device pixels, so a "pixel" looks the same size on phone and tablet
    const div = scale === 1 ? Math.max(1, dpr / 1.6) : scale * dpr * 0.5;
    const tw = Math.max(1, Math.round((w * dpr) / div)), th = Math.max(1, Math.round((h * dpr) / div));
    target.setSize(tw, th);
    uniforms.uRes.value.set(tw, th);
    uniforms.uLevels.value = scale === 1 ? 0 : 20;
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    return { tw, th };
  }

  return {
    get scale() { return scale; },
    setScale(s: number) { scale = s; return resize(); },
    resize,
    render(scene: THREE.Scene, camera: THREE.Camera) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);
    },
  };
}
