"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import css from "./profile-hero.module.css";

/* 🧊 3D-персонаж на подиуме (19.11.2026). Пока модель не готова — и всегда,
   когда что-то пошло не так, — виден 2D-рендер (`fallback`): клиент никогда
   не смотрит на пустое место.

   Только на сильных устройствах: WebGL, ≥4 ядра, ≥4 ГБ памяти, без режима
   экономии трафика. three.js (~150 КБ gzip) грузится лениво, только когда
   сервер ответил «модель есть» (`/api/account/avatar-3d`).

   Статично, как решил владелец: без покачивания и автоповорота. Покрутить
   можно пальцем/мышью — только вокруг вертикали, без зума. Кадр рисуется лишь
   на поворот, в простое GPU не занят.

   Файлы модели (манифест, obj, mtl, текстуры) — с rbxcdn напрямую в браузер
   (CORS `*`); с RF-хоста этот CDN не резолвится. */

type Manifest = {
  camera?: { position?: Vec; fov?: number };
  aabb?: { min?: Vec; max?: Vec };
  obj?: string;
  mtl?: string;
  textures?: string[];
};
type Vec = { x?: number; y?: number; z?: number };

/** Хеш файла 3D-модели → адрес на CDN Roblox. Старые 32-символьные хеши
 *  раскиданы по t0…t7 по XOR символов, новые («30DAY-…») — на tr. */
export function rbxCdnUrl(hash: string): string {
  if (/^https:\/\//.test(hash)) return hash;
  if (/^[0-9a-f]{32}$/i.test(hash)) {
    let i = 31;
    for (let t = 0; t < 32; t++) i ^= hash.charCodeAt(t);
    return `https://t${i % 8}.rbxcdn.com/${hash}`;
  }
  return `https://tr.rbxcdn.com/${hash}`;
}

function strongDevice(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return false;
  if ((nav.hardwareConcurrency ?? 4) < 4) return false;
  if ((nav.deviceMemory ?? 4) < 4) return false;
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`cdn ${res.status}`);
  return res.text();
}

export default function Avatar3d({ fallback, alt }: { fallback: ReactNode; alt: string }) {
  const host = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!strongDevice()) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      const api = await fetch("/api/account/avatar-3d", { credentials: "same-origin" }).then((r) => r.json()).catch(() => null);
      if (cancelled || api?.status !== "ready" || typeof api.manifestUrl !== "string") return;
      const manifest = JSON.parse(await fetchText(api.manifestUrl)) as Manifest;
      if (!manifest.obj || !manifest.mtl) return;
      const [THREE, { OBJLoader }, { MTLLoader }, { OrbitControls }] = await Promise.all([
        import("three"),
        import("three/examples/jsm/loaders/OBJLoader.js"),
        import("three/examples/jsm/loaders/MTLLoader.js"),
        import("three/examples/jsm/controls/OrbitControls.js"),
      ]);
      if (cancelled || !host.current) return;

      // Текстуры в mtl названы хешами — подменяем на адреса CDN.
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => {
        const last = url.split("/").pop() ?? url;
        return /^[A-Za-z0-9-]+$/.test(last) ? rbxCdnUrl(last) : url;
      });
      const [mtlText, objText] = await Promise.all([fetchText(rbxCdnUrl(manifest.mtl)), fetchText(rbxCdnUrl(manifest.obj))]);
      const mtl = new MTLLoader(manager);
      mtl.setCrossOrigin("anonymous");
      const materials = mtl.parse(mtlText, "");
      materials.preload();
      const model = new OBJLoader(manager).setMaterials(materials).parse(objText);
      await new Promise<void>((resolve) => {
        manager.onLoad = () => resolve();
        // Текстур может не быть вовсе — тогда onLoad не придёт.
        setTimeout(resolve, 4000);
      });
      if (cancelled || !host.current) return;

      const width = host.current.clientWidth || 300;
      const height = host.current.clientHeight || 300;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute("role", "img");
      renderer.domElement.setAttribute("aria-label", alt);

      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(-1, 2, 3);
      scene.add(sun);
      scene.add(model);

      // Рамка модели: из манифеста, иначе — посчитать.
      const box = new THREE.Box3();
      const { min, max } = manifest.aabb ?? {};
      if (min && max) box.set(new THREE.Vector3(min.x ?? 0, min.y ?? 0, min.z ?? 0), new THREE.Vector3(max.x ?? 0, max.y ?? 0, max.z ?? 0));
      else box.setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const fov = 30;
      const camera = new THREE.PerspectiveCamera(fov, width / height, 0.1, 1000);
      // Сторона, с которой смотрит камера Roblox (лицом к игроку).
      const p = manifest.camera?.position;
      const side = p ? new THREE.Vector3(p.x ?? 0, 0, p.z ?? 1).sub(new THREE.Vector3(center.x, 0, center.z)) : new THREE.Vector3(0, 0, 1);
      if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
      side.normalize();
      const fitH = size.y / 2 / Math.tan((fov * Math.PI) / 360);
      const fitW = Math.max(size.x, size.z) / 2 / Math.tan((fov * Math.PI) / 360) / (width / height);
      const dist = Math.max(fitH, fitW) * 1.08 + Math.max(size.x, size.z) / 2;
      camera.position.copy(center).addScaledVector(side, dist);
      camera.lookAt(center);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(center);
      controls.enableZoom = false;
      controls.enablePan = false;
      controls.minPolarAngle = controls.maxPolarAngle = Math.PI / 2;
      controls.rotateSpeed = 0.6;
      // OrbitControls ставит touch-action:none — на телефоне это убило бы
      // прокрутку страницы через карточку. Вертикаль отдаём браузеру.
      renderer.domElement.style.touchAction = "pan-y";
      const render = () => renderer.render(scene, camera);
      controls.addEventListener("change", render);
      controls.update();
      render();

      host.current.appendChild(renderer.domElement);
      setReady(true);
      cleanup = () => {
        controls.dispose();
        renderer.dispose();
        scene.traverse((o) => {
          const mesh = o as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void } | { dispose(): void }[] };
          mesh.geometry?.dispose();
          for (const m of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) m.dispose();
        });
        renderer.domElement.remove();
      };
    })().catch(() => {
      // Любой сбой — остаётся 2D; в консоль, чтобы было видно при отладке.
      console.warn("[avatar-3d] 3D не собрался — показываем 2D");
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [alt]);

  return (
    <span className={css.podium3d}>
      <span ref={host} className={ready ? css.stage3d : css.stage3dHidden} aria-hidden={!ready} />
      {!ready && fallback}
      {ready && <span className={css.podiumBase} aria-hidden="true" />}
    </span>
  );
}
