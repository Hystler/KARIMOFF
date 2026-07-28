"use client";

import { useEffect, useRef, useState } from "react";
import { Move3d, Pause, Play, RotateCcw } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { AvatarConfig } from "@/lib/avatar-schema";

type Avatar3DStudioProps = {
  avatar: AvatarConfig;
};

type AvatarRig = {
  root: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  eyes: THREE.Mesh[];
};

type StudioRuntime = {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  setAvatar: (avatar: AvatarConfig) => void;
};

const stageClasses: Record<string, string> = {
  studio_orange: "bg-[#D95405]",
  night_city: "bg-[#09090B]",
  kitchen_line: "bg-[#171719]",
  clean: "bg-[#EDE8E1]",
  orange: "bg-[#D95405]",
  black: "bg-[#09090B]",
  grill: "bg-[#171719]",
  neon: "bg-[#09090B]"
};

const bodyShapes: Record<string, { bodyLength: number; bodyRadius: number; headY: number; headScale: [number, number, number]; shoulder: number }> = {
  panda_rookie: { bodyLength: 0.96, bodyRadius: 0.78, headY: 3.18, headScale: [1.08, 1.04, 0.94], shoulder: 0.88 },
  panda_titan: { bodyLength: 1.42, bodyRadius: 0.82, headY: 3.62, headScale: [0.98, 1.04, 0.9], shoulder: 1.05 },
  panda_core: { bodyLength: 1.18, bodyRadius: 0.74, headY: 3.4, headScale: [1, 1, 0.92], shoulder: 0.94 },
  panda_round: { bodyLength: 0.96, bodyRadius: 0.78, headY: 3.18, headScale: [1.08, 1.04, 0.94], shoulder: 0.88 },
  panda_strict: { bodyLength: 1.42, bodyRadius: 0.82, headY: 3.62, headScale: [0.98, 1.04, 0.9], shoulder: 1.05 },
  panda: { bodyLength: 1.18, bodyRadius: 0.74, headY: 3.4, headScale: [1, 1, 0.92], shoulder: 0.94 }
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

  const platform = createMesh(new THREE.CylinderGeometry(1.75, 1.9, 0.18, 48), dark, [0, 0.02, 0]);
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
    const ring = createMesh(new THREE.TorusGeometry(2.2, 0.06, 12, 96), background === "clean" ? orange : cream, [0, 2.45, -2.4]);
    stage.add(ring);
    [-2.7, 2.7].forEach((x) => {
      stage.add(createMesh(new THREE.BoxGeometry(0.11, 3.4, 0.12), background === "clean" ? dark : cream, [x, 2.1, -2.5]));
    });
  }

  return stage;
}

function createAvatarRig(avatar: AvatarConfig): AvatarRig {
  const root = new THREE.Group();
  const shape = bodyShapes[avatar.base] ?? bodyShapes.panda_core;
  const white = new THREE.MeshStandardMaterial({ color: 0xf7f5f1, roughness: 0.62 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.48 });
  const graphite = new THREE.MeshStandardMaterial({ color: 0x242427, roughness: 0.7 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xfb670a, roughness: 0.52 });
  const softOrange = new THREE.MeshStandardMaterial({ color: 0xffa060, roughness: 0.5 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xbfc0c4, roughness: 0.24, metalness: 0.74 });
  const clothes = avatar.clothes;
  const torsoMaterial =
    clothes === "chef_jacket"
      ? white
      : clothes === "varsity_orange" || clothes === "orange_apron"
        ? orange
        : graphite;

  const torsoY = shape.headY - 1.56;
  const torso = createMesh(
    new THREE.CapsuleGeometry(shape.bodyRadius, shape.bodyLength, 10, 24),
    torsoMaterial,
    [0, torsoY, 0]
  );
  root.add(torso);

  const leftLeg = createMesh(new THREE.CapsuleGeometry(0.25, 0.72, 8, 16), black, [-0.43, 0.72, 0]);
  const rightLeg = createMesh(new THREE.CapsuleGeometry(0.25, 0.72, 8, 16), black, [0.43, 0.72, 0]);
  const leftShoe = createMesh(new THREE.SphereGeometry(0.34, 20, 14), graphite, [-0.43, 0.28, 0.16], [1.12, 0.62, 1.42]);
  const rightShoe = createMesh(new THREE.SphereGeometry(0.34, 20, 14), graphite, [0.43, 0.28, 0.16], [1.12, 0.62, 1.42]);
  root.add(leftLeg, rightLeg, leftShoe, rightShoe);

  const sleeveMaterial = clothes === "chef_jacket" ? white : clothes === "varsity_orange" ? black : torsoMaterial;
  const leftArm = createMesh(new THREE.CapsuleGeometry(0.24, 0.98, 8, 16), sleeveMaterial, [-shape.shoulder, torsoY + 0.02, 0]);
  const rightArm = createMesh(new THREE.CapsuleGeometry(0.24, 0.98, 8, 16), sleeveMaterial, [shape.shoulder, torsoY + 0.02, 0]);
  leftArm.rotation.z = 0.13;
  rightArm.rotation.z = -0.13;
  const leftPaw = createMesh(new THREE.SphereGeometry(0.28, 18, 14), black, [-shape.shoulder - 0.13, torsoY - 0.68, 0.03]);
  const rightPaw = createMesh(new THREE.SphereGeometry(0.28, 18, 14), black, [shape.shoulder + 0.13, torsoY - 0.68, 0.03]);
  root.add(leftArm, rightArm, leftPaw, rightPaw);

  if (clothes === "varsity_orange") {
    root.add(
      createMesh(new THREE.BoxGeometry(0.08, 1.45, 0.08), white, [0, torsoY + 0.05, shape.bodyRadius + 0.05]),
      createMesh(new THREE.TorusGeometry(0.18, 0.045, 8, 32), white, [-0.3, torsoY + 0.28, shape.bodyRadius + 0.06])
    );
  } else if (clothes === "chef_jacket" || clothes === "orange_apron") {
    [-0.2, 0.2].forEach((x) => {
      [torsoY + 0.36, torsoY + 0.02, torsoY - 0.32].forEach((y) => {
        root.add(createMesh(new THREE.SphereGeometry(0.045, 12, 8), orange, [x, y, shape.bodyRadius + 0.08]));
      });
    });
    const scarf = createMesh(new THREE.ConeGeometry(0.25, 0.32, 3), orange, [0, torsoY + 0.78, shape.bodyRadius + 0.04]);
    scarf.rotation.z = Math.PI;
    root.add(scarf);
  } else if (clothes === "utility_black" || clothes === "black_apron") {
    const leftStrap = createMesh(new THREE.BoxGeometry(0.11, 1.38, 0.07), orange, [-0.34, torsoY + 0.05, shape.bodyRadius + 0.07]);
    const rightStrap = createMesh(new THREE.BoxGeometry(0.11, 1.38, 0.07), orange, [0.34, torsoY + 0.05, shape.bodyRadius + 0.07]);
    leftStrap.rotation.z = -0.18;
    rightStrap.rotation.z = 0.18;
    root.add(leftStrap, rightStrap);
  } else if (clothes === "black_hoodie") {
    root.add(createMesh(new THREE.TorusGeometry(0.7, 0.12, 12, 48), graphite, [0, torsoY + 0.72, -0.08]));
  }

  const head = new THREE.Group();
  head.position.y = shape.headY;
  const headMesh = createMesh(new THREE.SphereGeometry(0.92, 36, 28), white, [0, 0, 0], shape.headScale);
  const leftEar = createMesh(new THREE.SphereGeometry(0.3, 20, 16), black, [-0.66, 0.66, -0.05]);
  const rightEar = createMesh(new THREE.SphereGeometry(0.3, 20, 16), black, [0.66, 0.66, -0.05]);
  head.add(headMesh, leftEar, rightEar);

  const eyeY = 0.18;
  const eyeZ = 0.77;
  const eyes: THREE.Mesh[] = [];
  [-0.31, 0.31].forEach((x, index) => {
    const patch = createMesh(new THREE.SphereGeometry(0.27, 24, 18), black, [x, eyeY, eyeZ], [0.82, 1.12, 0.24]);
    patch.rotation.z = index === 0 ? -0.14 : 0.14;
    const eye = createMesh(
      new THREE.SphereGeometry(0.09, 18, 14),
      avatar.eyes === "happy" ? softOrange : white,
      [x, eyeY + 0.01, eyeZ + 0.18],
      [1, avatar.eyes === "sleepy" ? 0.3 : avatar.eyes === "happy" ? 0.58 : 1, 0.35]
    );
    eye.userData.baseScaleY = eye.scale.y;
    const pupil = createMesh(new THREE.SphereGeometry(0.038, 14, 10), black, [x, eyeY + 0.01, eyeZ + 0.255], [1, 1, 0.45]);
    pupil.userData.baseScaleY = pupil.scale.y;
    eyes.push(eye, pupil);
    head.add(patch, eye, pupil);
  });

  if (avatar.eyes === "focused" || avatar.eyes === "serious") {
    [-0.31, 0.31].forEach((x, index) => {
      const brow = createMesh(new THREE.BoxGeometry(0.32, 0.055, 0.06), black, [x, 0.48, 0.83]);
      brow.rotation.z = index === 0 ? -0.18 : 0.18;
      head.add(brow);
    });
  }

  const muzzle = createMesh(new THREE.SphereGeometry(0.34, 24, 18), white, [0, -0.26, 0.82], [1.15, 0.72, 0.34]);
  const nose = createMesh(new THREE.SphereGeometry(0.11, 18, 12), black, [0, -0.18, 1.0], [1.08, 0.72, 0.45]);
  head.add(muzzle, nose);

  if (avatar.mouth === "grin") {
    const grin = createMesh(new THREE.SphereGeometry(0.2, 20, 14), white, [0, -0.43, 1.0], [1.45, 0.58, 0.2]);
    const grinOutline = createMesh(new THREE.TorusGeometry(0.2, 0.025, 8, 32, Math.PI), black, [0, -0.38, 1.04], [1.35, 0.8, 1]);
    grinOutline.rotation.z = Math.PI;
    head.add(grin, grinOutline);
  } else {
    const mouth = createMesh(
      new THREE.TorusGeometry(avatar.mouth === "smirk" ? 0.16 : 0.18, 0.025, 8, 28, avatar.mouth === "neutral" ? Math.PI * 0.35 : Math.PI),
      black,
      [avatar.mouth === "smirk" ? 0.08 : 0, -0.39, 1.02],
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
    const brim = createMesh(new THREE.BoxGeometry(0.86, 0.08, 0.42), capMaterial, [0.32, 0.62, 0.62]);
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
          [x, eyeY + 0.01, 1.01]
        )
      );
    });
    head.add(createMesh(new THREE.BoxGeometry(0.2, 0.045, 0.045), black, [0, eyeY + 0.02, 1.01]));
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
        [0, eyeY + 0.02, 1.02]
      )
    );
  }

  const collar = createMesh(new THREE.TorusGeometry(0.46, 0.055, 10, 36), clothes === "chef_jacket" ? orange : silver, [0, -0.82, 0]);
  collar.rotation.x = Math.PI / 2;
  head.add(collar);
  root.add(head);

  root.rotation.y = -0.08;
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
    if (runtimeRef.current) {
      runtimeRef.current.controls.autoRotate = !paused;
    }
  }, [paused]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 2.35, 8.65);
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

    scene.add(new THREE.HemisphereLight(0xfff4e8, 0x171719, 2.15));
    const key = new THREE.DirectionalLight(0xffffff, 4.2);
    key.position.set(3.8, 6.5, 5.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 16;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xfb670a, 3.1);
    rim.position.set(-4.5, 3.2, -2.4);
    scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enablePan = false;
    controls.minDistance = 6.25;
    controls.maxDistance = 10.5;
    controls.minPolarAngle = Math.PI * 0.31;
    controls.maxPolarAngle = Math.PI * 0.61;
    controls.target.set(0, 2.05, 0);
    controls.autoRotate = !pausedRef.current;
    controls.autoRotateSpeed = 0.72;

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
    runtime.camera.position.set(0, 2.35, 8.65);
    runtime.controls.target.set(0, 2.05, 0);
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
      <div className="pointer-events-none absolute bottom-5 right-5 hidden items-center gap-2 text-xs font-semibold text-white/72 sm:flex">
        <Move3d size={16} />
        Тяните, чтобы вращать
      </div>
    </div>
  );
}
