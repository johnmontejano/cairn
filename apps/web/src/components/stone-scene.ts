/**
 * The landing hero, in three dimensions.
 *
 * Five stones drift apart at the top of the page and settle into a balanced
 * cairn as the person scrolls — the product's story told by its own mark:
 * scattered context, deliberately assembled. Loaded on demand from
 * `hero-scene.tsx` so only the landing page ever pays for it, and only after
 * the static drawing is already on screen.
 *
 * Craft constraints, so the flourish never costs what it isn't worth:
 * - Colours come from the live `--cairn-*` tokens, so both themes just work
 *   and a theme flip mid-session recolours the stones in place.
 * - The render loop runs only while the hero is on screen and the tab is
 *   visible; pixel ratio is clamped so a retina laptop is not rendering
 *   four times the pixels for an ambient illustration.
 * - Everything is disposed on unmount: geometry, materials, renderer,
 *   observers, the scroll trigger.
 */
import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

interface StoneSpec {
  /** CSS custom property the stone's colour comes from. */
  colorVar: string;
  scale: [number, number, number];
  /** Where the stone rests once the cairn is assembled. */
  home: { position: [number, number, number]; rotation: [number, number, number] };
  /** Where it starts at the top of the page. */
  adrift: { position: [number, number, number]; rotation: [number, number, number] };
}

/**
 * The adrift constellation is framed, not random: the camera (fov 34 at
 * z≈10, aimed at y 1.6) sees roughly x ±3, y −1.4…4.6, and every scattered
 * stone stays inside that so the top of the page reads as five stones
 * hovering, not two blobs and three absences.
 */
/**
 * Stone colours are picked from tokens that hold their own on BOTH grounds —
 * the landing commits to dark, but the same scene must survive a light
 * theme if it is ever reused. Surface-toned tokens are deliberately absent:
 * on the committed-dark landing they melt into the background.
 */
const STONES: readonly StoneSpec[] = [
  {
    colorVar: '--cairn-ink-subtle',
    scale: [2.05, 0.6, 1.4],
    home: { position: [0, 0, 0], rotation: [0, 0.1, 0] },
    adrift: { position: [-0.5, 3.4, -0.9], rotation: [0.45, 0.6, 0.35] },
  },
  {
    colorVar: '--cairn-border-strong',
    scale: [1.65, 0.52, 1.12],
    home: { position: [0.06, 0.95, 0.02], rotation: [0, -0.14, 0.02] },
    adrift: { position: [-2.2, 1.1, 0.6], rotation: [-0.4, 0.2, -0.55] },
  },
  {
    colorVar: '--cairn-accent',
    scale: [1.4, 0.47, 0.95],
    home: { position: [-0.04, 1.8, 0], rotation: [0, 0.22, -0.02] },
    adrift: { position: [2.3, 2.6, 0.4], rotation: [0.3, -0.35, 0.6] },
  },
  {
    colorVar: '--cairn-ink-subtle',
    scale: [1.12, 0.4, 0.76],
    home: { position: [0.05, 2.55, -0.02], rotation: [0, -0.1, 0.03] },
    adrift: { position: [-1.5, 4.2, -0.5], rotation: [0.6, 0.1, 0.5] },
  },
  {
    colorVar: '--cairn-ink-muted',
    scale: [0.85, 0.34, 0.58],
    home: { position: [-0.02, 3.2, 0.03], rotation: [0, 0.3, 0.09] },
    adrift: { position: [1.7, 0.4, 1.0], rotation: [-0.5, 0.45, -0.35] },
  },
];

/**
 * Reads the token from the canvas's own container, not the document root —
 * the landing page scopes its committed-dark overrides to `.cairn-landing`,
 * so the root would answer with the light values while the scene sits on a
 * near-black ground.
 */
function tokenColor(from: Element, name: string): THREE.Color {
  const raw = getComputedStyle(from).getPropertyValue(name).trim();
  const color = new THREE.Color();
  color.setStyle(raw || '#888888');
  return color;
}

/**
 * Builds the scene into `container` and returns a cleanup function.
 * Throws when WebGL is unavailable, which the caller treats as "keep the
 * static drawing" rather than an error worth showing anyone.
 */
export function mountStoneScene(container: HTMLElement): () => void {
  gsap.registerPlugin(ScrollTrigger);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(container.clientWidth || 320, container.clientHeight || 300);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    34,
    (container.clientWidth || 320) / (container.clientHeight || 300),
    0.1,
    50,
  );
  camera.position.set(0, 2.4, 10.2);
  const lookTarget = new THREE.Vector3(0, 1.6, 0);
  camera.lookAt(lookTarget);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4552, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.35);
  key.position.set(4, 7, 6);
  scene.add(key);
  // A faint indigo rim from below-left, so the night ground reads as lit air
  // rather than a void.
  const rim = new THREE.PointLight(tokenColor(container, '--cairn-accent'), 6, 14, 1.8);
  rim.position.set(-3.5, 0.4, 2.5);
  scene.add(rim);

  const group = new THREE.Group();
  scene.add(group);

  const geometry = new THREE.SphereGeometry(1, 48, 32);
  const materials: THREE.MeshStandardMaterial[] = [];
  const meshes = STONES.map((spec) => {
    const material = new THREE.MeshStandardMaterial({
      color: tokenColor(container, spec.colorVar),
      roughness: 0.9,
      metalness: 0.02,
    });
    materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(...spec.scale);
    mesh.position.set(...spec.adrift.position);
    mesh.rotation.set(...spec.adrift.rotation);
    group.add(mesh);
    return mesh;
  });

  // Dust in the light: a handful of slow motes drifting upward through the
  // scene, so the night air has depth. Cheap — one Points object, no per-frame
  // allocation — and disposed with everything else.
  const moteCount = 90;
  const motePositions = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i += 1) {
    motePositions[i * 3] = (Math.random() - 0.5) * 8;
    motePositions[i * 3 + 1] = Math.random() * 6 - 1;
    motePositions[i * 3 + 2] = (Math.random() - 0.5) * 5;
  }
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  const moteMaterial = new THREE.PointsMaterial({
    color: tokenColor(container, '--cairn-accent'),
    size: 0.035,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const motes = new THREE.Points(moteGeometry, moteMaterial);
  scene.add(motes);

  // A soft blob rather than a real shadow map: the grounding matters, the
  // gigawatts do not.
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: tokenColor(container, '--cairn-ink'),
    transparent: true,
    opacity: 0.02,
  });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.9, 40), shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.62;
  shadow.scale.set(1.2, 0.62, 1);
  group.add(shadow);

  // A theme flip mid-session recolours in place instead of leaving the scene
  // wearing the previous theme's palette.
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const recolor = () => {
    STONES.forEach((spec, i) => materials[i]!.color.copy(tokenColor(container, spec.colorVar)));
    shadowMaterial.color.copy(tokenColor(container, '--cairn-ink'));
    rim.color.copy(tokenColor(container, '--cairn-accent'));
    moteMaterial.color.copy(tokenColor(container, '--cairn-accent'));
  };
  darkQuery.addEventListener('change', recolor);

  // Scroll choreography, keyed to where the scene actually is on screen.
  // On a wide viewport the canvas shares the first fold, so progress 0 sits
  // at the very top of the page and assembly completes after about a third
  // of a viewport — early enough that the finished stack is still visible
  // when it locks in, because an ending nobody can see is not an ending.
  // On a narrow viewport the hero stacks copy-first and the stones live a
  // viewport down, so the same window is keyed to the canvas's own arrival
  // instead — otherwise a phone would only ever meet the finished stack and
  // the page's one story would never play. Scrubbed either way, so it moves
  // forwards and backwards with the person, not on its own schedule.
  const narrow = window.matchMedia('(max-width: 62rem)').matches;
  const timeline = gsap.timeline({
    scrollTrigger: {
      trigger: narrow ? container : document.body,
      start: narrow ? 'top 90%' : 'top top',
      end: () => `+=${Math.round(window.innerHeight * (narrow ? 0.45 : 0.35))}`,
      scrub: 0.6,
      // Ground truth for tests and debugging: screenshots of a live canvas
      // are unreliable, an attribute is not.
      onUpdate: (self) => {
        container.dataset.sceneProgress = self.progress.toFixed(3);
      },
    },
  });
  meshes.forEach((mesh, i) => {
    const spec = STONES[i]!;
    const at = i * 0.09;
    timeline.to(
      mesh.position,
      { ...vec(spec.home.position), duration: 1, ease: 'power2.inOut' },
      at,
    );
    timeline.to(
      mesh.rotation,
      { ...vec(spec.home.rotation), duration: 1, ease: 'power2.inOut' },
      at,
    );
  });
  timeline.to(shadowMaterial, { opacity: 0.09, duration: 0.6, ease: 'none' }, 0.35);
  timeline.to(camera.position, { y: 2.0, z: 9.2, duration: 1.2, ease: 'power1.inOut' }, 0);
  timeline.to(group.rotation, { y: 0.14, duration: 1.2, ease: 'power1.inOut' }, 0);

  // Pointer parallax: the camera leans a small, eased amount toward the
  // pointer, so the scene reads as an object in space rather than a video.
  // Only wired up for fine pointers — on touch it would fight the scroll.
  const parallax = { x: 0, y: 0, targetX: 0, targetY: 0 };
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const onPointerMove = (event: PointerEvent) => {
    parallax.targetX = (event.clientX / window.innerWidth - 0.5) * 2;
    parallax.targetY = (event.clientY / window.innerHeight - 0.5) * 2;
  };
  if (finePointer) window.addEventListener('pointermove', onPointerMove, { passive: true });

  // Render only while it can be seen. The idle drift is deliberately tiny —
  // alive, not busy.
  let running = false;
  let frame = 0;
  const tick = (now: number) => {
    if (!running) return;
    group.position.y = Math.sin(now * 0.0009) * 0.05;
    // Ease toward the pointer at a tenth of the distance per frame — slow
    // enough to feel like weight, not tracking.
    parallax.x += (parallax.targetX - parallax.x) * 0.06;
    parallax.y += (parallax.targetY - parallax.y) * 0.06;
    camera.position.x = parallax.x * 0.55;
    camera.lookAt(lookTarget);
    // The motes rise slowly and wrap; the buffer is mutated in place.
    const positions = moteGeometry.attributes.position!;
    for (let i = 0; i < moteCount; i += 1) {
      let y = positions.getY(i) + 0.0035;
      if (y > 5.2) y = -1;
      positions.setY(i, y);
    }
    positions.needsUpdate = true;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  const setRunning = (next: boolean) => {
    if (next === running) return;
    running = next;
    if (running) frame = requestAnimationFrame(tick);
    else cancelAnimationFrame(frame);
  };
  const intersection = new IntersectionObserver(
    (entries) => setRunning(entries.some((e) => e.isIntersecting) && !document.hidden),
    { threshold: 0 },
  );
  intersection.observe(container);
  const onVisibility = () => setRunning(!document.hidden);
  document.addEventListener('visibilitychange', onVisibility);

  const resize = new ResizeObserver(() => {
    const width = container.clientWidth || 320;
    const height = container.clientHeight || 300;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });
  resize.observe(container);

  setRunning(true);

  return () => {
    setRunning(false);
    intersection.disconnect();
    resize.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    if (finePointer) window.removeEventListener('pointermove', onPointerMove);
    darkQuery.removeEventListener('change', recolor);
    moteGeometry.dispose();
    moteMaterial.dispose();
    timeline.scrollTrigger?.kill();
    timeline.kill();
    geometry.dispose();
    shadow.geometry.dispose();
    shadowMaterial.dispose();
    for (const material of materials) material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

function vec([x, y, z]: [number, number, number]): { x: number; y: number; z: number } {
  return { x, y, z };
}
