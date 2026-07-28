"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { AvatarConfig } from "@/lib/avatar-schema";

type Avatar3DStudioProps = {
  avatar: AvatarConfig;
};

type AvatarRig = {
  root: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  eyes: THREE.Mesh[];
};

type StudioRuntime = {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  setAvatar: (avatar: AvatarConfig) => void;
};

const stageClasses: Record<string, string> = {
  studio_orange: "bg-[#171719]",
  night_city: "bg-[#09090B]",
  kitchen_line: "bg-[#171719]",
  clean: "bg-[#EDE8E1]",
  orange: "bg-[#171719]",
  black: "bg-[#09090B]",
  grill: "bg-[#171719]",
  neon: "bg-[#09090B]"
};

const bodyShapes: Record<string, { bodyLength: number; bodyRadius: number; headY: number; headScale: [number, number, number]; shoulder: number }> = {
  panda_rookie: { bodyLength: 1.02, bodyRadius: 0.7, headY: 3.08, headScale: [1.04, 1.02, 0.88], shoulder: 0.76 },
  panda_titan: { bodyLength: 1.28, bodyRadius: 0.82, headY: 3.46, headScale: [0.98, 1.02, 0.86], shoulder: 0.92 },
  panda_core: { bodyLength: 1.15, bodyRadius: 0.75, headY: 3.28, headScale: [1, 1, 0.87], shoulder: 0.84 },
  panda_round: { bodyLength: 1.02, bodyRadius: 0.7, headY: 3.08, headScale: [1.04, 1.02, 0.88], shoulder: 0.76 },
  panda_strict: { bodyLength: 1.28, bodyRadius: 0.82, headY: 3.46, headScale: [0.98, 1.02, 0.86], shoulder: 0.92 },
  panda: { bodyLength: 1.15, bodyRadius: 0.75, headY: 3.28, headScale: [1, 1, 0.87], shoulder: 0.84 }
};

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

function createMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1]
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createStage(background: string) {
  const stage = new THREE.Group();
  const orange = new THREE.MeshStandardMaterial({ color: 0xfb670a, roughness: 0.42, metalness: 0.08 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.52, metalness: 0.28 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x67676c, roughness: 0.3, metalness: 0.72 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xeee8df, roughness: 0.72 });

  const platform = createMesh(new THREE.CylinderGeometry(1.58, 1.72, 0.14, 64), dark, [0, 0.02, 0]);
  stage.add(platform);

  if (background === "night_city" || background === "black" || background === "neon") {
    [-2.4, -1.55, 1.55, 2.35].forEach((x, index) => {
      const height = 1.8 + (index % 2) * 1.1;
      const tower = createMesh(new THREE.BoxGeometry(0.68, height, 0.55), dark.clone(), [x, height / 2 + 0.22, -2.6]);
      stage.add(tower);
      for (let row = 0; row < 3; row += 1) {
        const light = createMesh(
          new THREE.BoxGeometry(0.2, 0.08, 0.02),
          new THREE.MeshStandardMaterial({ color: 0xfb670a, emissive: 0xfb670a, emissiveIntensity: 2.1 }),
          [x, 0.72 + row * 0.48, -2.3]
        );
        stage.add(light);
      }
    });
  } else if (background === "kitchen_line" || background === "grill") {
    const counter = createMesh(new THREE.BoxGeometry(5.6, 0.75, 0.55), steel, [0, 0.65, -2.65]);
    const hood = createMesh(new THREE.BoxGeometry(3.4, 0.28, 0.72), dark, [0, 4.35, -2.55]);
    const chimney = createMesh(new THREE.BoxGeometry(1.45, 1.15, 0.6), steel, [0, 3.75, -2.65]);
    stage.add(counter, hood, chimney);
    [-1.85, 0, 1.85].forEach((x) => {
      stage.add(
        createMesh(
          new THREE.BoxGeometry(0.9, 0.06, 0.03),
          new THREE.MeshStandardMaterial({ color: 0xfb670a, emissive: 0xfb670a, emissiveIntensity: 1.8 }),
          [x, 1.2, -2.34]
        )
      );
    });
  } else {
    const ringMaterial = background === "clean" ? dark : background === "studio_orange" || background === "orange" ? orange : cream;
    const ring = createMesh(new THREE.TorusGeometry(2.05, 0.045, 12, 96), ringMaterial, [0, 2.32, -2.5]);
    stage.add(ring);
    [-2.55, 2.55].forEach((x) => {
      stage.add(createMesh(new THREE.BoxGeometry(0.07, 3.15, 0.08), ringMaterial, [x, 2.05, -2.55]));
    });
  }

  return stage;
}

function createAvatarRig(avatar: AvatarConfig): AvatarRig {
  const root = new THREE.Group();
  const shape = bodyShapes[avatar.base] ?? bodyShapes.panda_core;
  const white = new THREE.MeshStandardMaterial({ color: 0xf2eee8, roughness: 0.78 });
  const black = new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.68 });
  const graphite = new THREE.MeshStandardMaterial({ color: 0x26262a, roughness: 0.76 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xfb670a, roughness: 0.66 });
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xf8f4ed, roughness: 0.5 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xbfc0c4, roughness: 0.24, metalness: 0.74 });
  const clothes = avatar.clothes;
  const torsoMaterial =
    clothes === "chef_jacket"
      ? white
      : clothes === "varsity_orange" || clothes === "orange_apron"
        ? orange
        : graphite;

  const torsoY = shape.headY - 1.56;
  const torsoFront = shape.bodyRadius * 0.84;
  const torso = createMesh(new THREE.SphereGeometry(1, 40, 32), torsoMaterial, [0, torsoY, 0], [
    shape.bodyRadius * 1.12,
    shape.bodyLength,
    shape.bodyRadius * 0.84
  ]);
  root.add(torso);

  const leftLeg = createMesh(new THREE.CapsuleGeometry(0.21, 0.48, 10, 20), black, [-0.36, 0.68, 0]);
  const rightLeg = createMesh(new THREE.CapsuleGeometry(0.21, 0.48, 10, 20), black, [0.36, 0.68, 0]);
  const leftShoe = createMesh(new THREE.SphereGeometry(0.3, 24, 18), graphite, [-0.36, 0.3, 0.15], [1.18, 0.58, 1.42]);
  const rightShoe = createMesh(new THREE.SphereGeometry(0.3, 24, 18), graphite, [0.36, 0.3, 0.15], [1.18, 0.58, 1.42]);
  root.add(leftLeg, rightLeg, leftShoe, rightShoe);

  const sleeveMaterial = clothes === "chef_jacket" ? white : clothes === "varsity_orange" ? black : torsoMaterial;
  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  leftArm.position.set(-shape.shoulder, torsoY + 0.42, 0);
  rightArm.position.set(shape.shoulder, torsoY + 0.42, 0);
  leftArm.add(
    createMesh(new THREE.CapsuleGeometry(0.2, 0.68, 10, 20), sleeveMaterial, [0, -0.46, 0]),
    createMesh(new THREE.SphereGeometry(0.245, 22, 16), black, [-0.04, -0.98, 0.04])
  );
  rightArm.add(
    createMesh(new THREE.CapsuleGeometry(0.2, 0.68, 10, 20), sleeveMaterial, [0, -0.46, 0]),
    createMesh(new THREE.SphereGeometry(0.245, 22, 16), black, [0.04, -0.98, 0.04])
  );
  leftArm.rotation.z = 0.13;
  rightArm.rotation.z = -0.13;
  root.add(leftArm, rightArm);

  if (clothes === "varsity_orange") {
    root.add(
      createMesh(new THREE.BoxGeometry(0.06, 1.3, 0.045), white, [0, torsoY + 0.05, torsoFront + 0.025]),
      createMesh(new THREE.TorusGeometry(0.15, 0.035, 8, 32), white, [-0.27, torsoY + 0.26, torsoFront + 0.035])
    );
  } else if (clothes === "chef_jacket" || clothes === "orange_apron") {
    [-0.2, 0.2].forEach((x) => {
      [torsoY + 0.36, torsoY + 0.02, torsoY - 0.32].forEach((y) => {
        root.add(createMesh(new THREE.SphereGeometry(0.04, 16, 12), orange, [x, y, torsoFront + 0.035]));
      });
    });
    const scarf = createMesh(new THREE.ConeGeometry(0.21, 0.28, 3), orange, [0, torsoY + 0.76, torsoFront + 0.02]);
    scarf.rotation.z = Math.PI;
    root.add(scarf);
  } else if (clothes === "utility_black" || clothes === "black_apron") {
    const leftStrap = createMesh(new THREE.BoxGeometry(0.09, 1.25, 0.045), orange, [-0.31, torsoY + 0.05, torsoFront + 0.03]);
    const rightStrap = createMesh(new THREE.BoxGeometry(0.09, 1.25, 0.045), orange, [0.31, torsoY + 0.05, torsoFront + 0.03]);
    leftStrap.rotation.z = -0.18;
    rightStrap.rotation.z = 0.18;
    root.add(leftStrap, rightStrap);
  } else if (clothes === "black_hoodie") {
    root.add(createMesh(new THREE.TorusGeometry(0.7, 0.12, 12, 48), graphite, [0, torsoY + 0.72, -0.08]));
  }

  const head = new THREE.Group();
  head.position.y = shape.headY;
  const headMesh = createMesh(new THREE.SphereGeometry(0.88, 48, 36), white, [0, 0, 0], shape.headScale);
  const leftEar = createMesh(new THREE.SphereGeometry(0.27, 28, 20), black, [-0.61, 0.62, -0.07]);
  const rightEar = createMesh(new THREE.SphereGeometry(0.27, 28, 20), black, [0.61, 0.62, -0.07]);
  head.add(headMesh, leftEar, rightEar);

  const eyeY = 0.17;
  const eyeZ = 0.72;
  const eyes: THREE.Mesh[] = [];
  [-0.31, 0.31].forEach((x, index) => {
    const patch = createMesh(new THREE.SphereGeometry(0.25, 32, 24), black, [x, eyeY, eyeZ], [0.78, 1.14, 0.11]);
    patch.rotation.z = index === 0 ? -0.14 : 0.14;
    const eye = createMesh(
      new THREE.SphereGeometry(0.095, 28, 20),
      eyeWhite,
      [x, eyeY + 0.01, eyeZ + 0.065],
      [1, avatar.eyes === "sleepy" ? 0.34 : avatar.eyes === "happy" ? 0.76 : 0.92, 0.16]
    );
    eye.userData.baseScaleY = eye.scale.y;
    const pupil = createMesh(new THREE.SphereGeometry(0.032, 20, 14), black, [x, eyeY + 0.005, eyeZ + 0.105], [1, 1, 0.18]);
    pupil.userData.baseScaleY = pupil.scale.y;
    eyes.push(eye, pupil);
    head.add(patch, eye, pupil);
  });

  if (avatar.eyes === "focused" || avatar.eyes === "serious") {
    [-0.31, 0.31].forEach((x, index) => {
      const brow = createMesh(new THREE.CapsuleGeometry(0.026, 0.22, 6, 12), black, [x, 0.44, 0.76]);
      brow.rotation.x = Math.PI / 2;
      brow.rotation.z = index === 0 ? -0.18 : 0.18;
      head.add(brow);
    });
  }

  const muzzle = createMesh(new THREE.SphereGeometry(0.3, 32, 24), white, [0, -0.25, 0.72], [1.18, 0.72, 0.15]);
  const nose = createMesh(new THREE.SphereGeometry(0.095, 24, 18), black, [0, -0.17, 0.79], [1.1, 0.72, 0.35]);
  head.add(muzzle, nose);

  if (avatar.mouth === "grin") {
    const grin = createMesh(new THREE.SphereGeometry(0.17, 24, 18), eyeWhite, [0, -0.39, 0.79], [1.45, 0.54, 0.1]);
    const grinOutline = createMesh(new THREE.TorusGeometry(0.17, 0.018, 8, 36, Math.PI), black, [0, -0.35, 0.81], [1.35, 0.8, 1]);
    grinOutline.rotation.z = Math.PI;
    head.add(grin, grinOutline);
  } else {
    const mouth = createMesh(
      new THREE.TorusGeometry(avatar.mouth === "smirk" ? 0.14 : 0.16, 0.018, 8, 36, avatar.mouth === "neutral" ? Math.PI * 0.35 : Math.PI),
      black,
      [avatar.mouth === "smirk" ? 0.07 : 0, -0.38, 0.81],
      [1.2, avatar.mouth === "neutral" ? 0.08 : 0.72, 1]
    );
    mouth.rotation.z = avatar.mouth === "smirk" ? Math.PI * 1.08 : Math.PI;
    head.add(mouth);
  }

  const accessory = avatar.accessory;
  if (accessory === "orange_cap" || accessory === "black_cap") {
    const capMaterial = accessory === "black_cap" ? graphite : orange;
    const crown = createMesh(
      new THREE.SphereGeometry(0.76, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      capMaterial,
      [0, 0.68, 0],
      [1, 0.58, 1]
    );
    const brim = createMesh(new THREE.BoxGeometry(0.8, 0.07, 0.34), capMaterial, [0.28, 0.59, 0.55]);
    brim.rotation.y = -0.08;
    head.add(crown, brim);
  } else if (accessory === "headphones") {
    const band = createMesh(new THREE.TorusGeometry(0.77, 0.08, 12, 48, Math.PI), orange, [0, 0.17, -0.03]);
    const leftCup = createMesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 20), graphite, [-0.83, 0.08, 0]);
    const rightCup = createMesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 20), graphite, [0.83, 0.08, 0]);
    leftCup.rotation.z = Math.PI / 2;
    rightCup.rotation.z = Math.PI / 2;
    head.add(band, leftCup, rightCup);
  } else if (accessory === "sunglasses") {
    [-0.31, 0.31].forEach((x) => {
      head.add(
        createMesh(
          new THREE.BoxGeometry(0.42, 0.22, 0.055),
          new THREE.MeshPhysicalMaterial({ color: 0x080809, roughness: 0.08, metalness: 0.35, transmission: 0.08 }),
          [x, eyeY + 0.01, 0.82]
        )
      );
    });
    head.add(createMesh(new THREE.BoxGeometry(0.2, 0.04, 0.035), black, [0, eyeY + 0.02, 0.82]));
  } else if (accessory === "orange_visor") {
    head.add(
      createMesh(
        new THREE.BoxGeometry(1.02, 0.32, 0.08),
        new THREE.MeshPhysicalMaterial({
          color: 0xfb670a,
          transparent: true,
          opacity: 0.72,
          roughness: 0.08,
          metalness: 0.18,
          transmission: 0.12
        }),
        [0, eyeY + 0.02, 0.83]
      )
    );
  }

  const collar = createMesh(new THREE.TorusGeometry(0.42, 0.045, 10, 40), clothes === "chef_jacket" ? orange : silver, [0, -0.78, 0]);
  collar.rotation.x = Math.PI / 2;
  head.add(collar);
  root.add(head);

  root.rotation.y = 0;
  return { root, head, leftArm, rightArm, eyes };
}

export function Avatar3DStudio({ avatar }: Avatar3DStudioProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<StudioRuntime | null>(null);
  const avatarRef = useRef(avatar);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const stageClass = stageClasses[avatar.background] ?? stageClasses.studio_orange;

  useEffect(() => {
    avatarRef.current = avatar;
    runtimeRef.current?.setAvatar(avatar);
  }, [avatar]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0.14, 2.16, 9.6);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.touchAction = "pan-y";
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xfff6ed, 0x171719, 2.35));
    const key = new THREE.DirectionalLight(0xffffff, 3.6);
    key.position.set(3.4, 6.2, 5.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 16;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xfb670a, 2.3);
    rim.position.set(-4.5, 3.2, -2.4);
    scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enablePan = false;
    controls.minDistance = 8.4;
    controls.maxDistance = 10.8;
    controls.minPolarAngle = Math.PI * 0.43;
    controls.maxPolarAngle = Math.PI * 0.55;
    controls.minAzimuthAngle = -0.4;
    controls.maxAzimuthAngle = 0.4;
    controls.target.set(0, 1.95, 0);
    controls.autoRotate = false;

    let rig: AvatarRig | null = null;
    let stage: THREE.Group | null = null;

    const setAvatar = (nextAvatar: AvatarConfig) => {
      if (rig) {
        scene.remove(rig.root);
        disposeObject(rig.root);
      }
      if (stage) {
        scene.remove(stage);
        disposeObject(stage);
      }
      rig = createAvatarRig(nextAvatar);
      stage = createStage(nextAvatar.background);
      scene.add(stage, rig.root);
    };

    setAvatar(avatarRef.current);
    runtimeRef.current = { camera, controls, setAvatar };

    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const animationStartedAt = performance.now();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animationFrame = 0;
    const animate = () => {
      animationFrame = window.requestAnimationFrame(animate);
      const elapsed = (performance.now() - animationStartedAt) / 1000;

      if (rig && !pausedRef.current && !reducedMotion) {
        rig.root.position.y = Math.sin(elapsed * 1.45) * 0.025;
        rig.head.rotation.y = Math.sin(elapsed * 0.62) * 0.045;
        rig.head.rotation.z = Math.sin(elapsed * 0.48) * 0.014;
        rig.leftArm.rotation.z = 0.13 + Math.sin(elapsed * 1.1) * 0.028;
        rig.rightArm.rotation.z = -0.13 - Math.sin(elapsed * 1.1) * 0.028;
        const blinkPhase = elapsed % 4.6;
        const blink = blinkPhase < 0.16 ? Math.max(0.12, Math.abs(blinkPhase - 0.08) / 0.08) : 1;
        rig.eyes.forEach((eye) => {
          eye.scale.y = Math.max(Number(eye.userData.baseScaleY ?? 1) * blink, 0.08);
        });
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      if (rig) disposeObject(rig.root);
      if (stage) disposeObject(stage);
      renderer.dispose();
      renderer.domElement.remove();
      runtimeRef.current = null;
    };
  }, []);

  function resetView() {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.camera.position.set(0.14, 2.16, 9.6);
    runtime.controls.target.set(0, 1.95, 0);
    runtime.controls.update();
  }

  return (
    <div className={`relative h-full min-h-[430px] overflow-hidden ${stageClass}`}>
      <div ref={mountRef} className="absolute inset-0" aria-label="Интерактивный трёхмерный аватар" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/45 to-transparent" />
      <div className="absolute bottom-4 left-4 flex items-center gap-2 sm:bottom-6 sm:left-6">
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/35 text-white backdrop-blur-md transition hover:border-karimoff-orange hover:bg-black/55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          aria-label={paused ? "Запустить анимацию" : "Остановить анимацию"}
          title={paused ? "Запустить анимацию" : "Остановить анимацию"}
        >
          {paused ? <Play size={18} /> : <Pause size={18} />}
        </button>
        <button
          type="button"
          onClick={resetView}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/35 text-white backdrop-blur-md transition hover:border-karimoff-orange hover:bg-black/55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          aria-label="Вернуть камеру"
          title="Вернуть камеру"
        >
          <RotateCcw size={18} />
        </button>
      </div>
    </div>
  );
}
