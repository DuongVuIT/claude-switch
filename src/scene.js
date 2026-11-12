// Decorative only: the account controls remain usable without WebGL.
export function mountScene(host) {
  if (!host) return () => {};
  let disposed = false, renderer, group, scene, camera, frame = 0, resize, observer;
  let visible = true, last = 0, phase = 0;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const button = host.parentElement.querySelector('[data-motion]');
  let paused = localStorage.getItem('scene-paused') === 'true';
  const syncButton = () => {
    button.textContent = paused ? 'Bật chuyển động' : 'Dừng chuyển động';
    button.setAttribute('aria-pressed', String(paused));
    button.hidden = motion.matches;
  };
  const render = () => {
    if (disposed || !renderer || document.hidden || !visible) return;
    group.rotation.y = phase * .13;
    group.rotation.z = Math.sin(phase * .12) * .12;
    renderer.render(scene, camera);
  };
  const tick = time => {
    frame = 0;
    if (time - last >= 32) { phase += Math.min((time - last) / 1000, .05); last = time; render(); }
    if (!disposed && !paused && !motion.matches && !document.hidden && visible) frame = requestAnimationFrame(tick);
  };
  const update = () => {
    cancelAnimationFrame(frame); frame = 0; last = performance.now();
    syncButton(); render();
    if (renderer && !disposed && !paused && !motion.matches && !document.hidden && visible) frame = requestAnimationFrame(tick);
  };
  const toggle = () => { paused = !paused; localStorage.setItem('scene-paused', String(paused)); update(); };
  const cleanup = () => {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(frame); resize?.disconnect(); observer?.disconnect();
    button.removeEventListener('click', toggle); motion.removeEventListener('change', update);
    document.removeEventListener('visibilitychange', update);
    scene?.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    renderer?.dispose();
    if (renderer && !renderer.getContext().isContextLost()) renderer.forceContextLoss();
    renderer?.domElement.remove();
  };
  button.addEventListener('click', toggle);
  motion.addEventListener('change', update);
  document.addEventListener('visibilitychange', update);
  syncButton();
  // Return cleanup immediately, even if navigation occurs while the module loads.
  (async () => {
    try {
      const THREE = await import('../node_modules/three/build/three.module.js');
      if (disposed) return;
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      renderer.setClearColor(0x000000, 0);
      host.append(renderer.domElement);
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(36, 1, .1, 50); camera.position.z = 7.8;
      scene.add(new THREE.HemisphereLight(0xffe7d4, 0x3c3032, 3));
      const light = new THREE.DirectionalLight(0xffb58a, 5); light.position.set(3, 4, 5); scene.add(light);
      const rim = new THREE.DirectionalLight(0xa5c6ff, 4); rim.position.set(-4, 1, 2); scene.add(rim);
      group = new THREE.Group(); scene.add(group);
      const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(.83, .25, 160, 24, 2, 3), new THREE.MeshStandardMaterial({ color: 0xdca780, metalness: .78, roughness: .24 }));
      knot.rotation.set(.3, -.5, .2); group.add(knot);
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7 + i * .17, .012, 8, 100), new THREE.MeshBasicMaterial({ color: i === 1 ? 0xe8b38b : 0x8c7970, transparent: true, opacity: .55 }));
        ring.rotation.set(.8 + i * .25, .35 + i * .6, i * .4); group.add(ring);
        const node = new THREE.Mesh(new THREE.SphereGeometry(.065, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffd4ac }));
        node.position.set(Math.cos(i * 2.1) * 1.85, Math.sin(i * 2.1) * 1.85, 0); group.add(node);
      }
      const size = () => { if (disposed) return; const {width, height} = host.getBoundingClientRect(); if (!width || !height) return; renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); render(); };
      resize = new ResizeObserver(size); resize.observe(host);
      observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); }); observer.observe(host);
      renderer.domElement.addEventListener('webglcontextlost', event => { if (disposed) return; event.preventDefault(); cleanup(); host.dataset.scene = 'fallback'; button.hidden = true; });
      host.dataset.scene = 'ready'; size(); update();
    } catch {
      cleanup(); host.dataset.scene = 'fallback'; button.hidden = true;
    }
  })();
  return cleanup;
}
