/* Progressive enhancement only: visible content is the default. */
(() => {
  'use strict';
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const nativeTimeline = typeof CSS !== 'undefined'
    && CSS.supports('animation-timeline: view()')
    && CSS.supports('view-timeline-name: --mv4-route');
  const sceneSelector = '.route-art, .vocab-art, .listening-art, .jai-art, .game-showcase, .progress-art';
  const groups = new Map();
  const played = new WeakSet();
  let observer;

  // Only direct scene layers move. The source images and device displays do not.
  const scenes = [...document.querySelectorAll(sceneSelector)];
  for (const scene of scenes) {
    for (const layer of scene.children) {
      if (layer.matches('.device, .creative, .floating-label, .word-float, .route-orbit, .sound-rings, .sound-bars')) {
        layer.classList.add('mv4-layer');
      }
    }
  }

  function addSequence(selector, childSelector, step = 60, individual = false) {
    for (const group of document.querySelectorAll(selector)) {
      const children = [...group.children].filter(child => child.matches(childSelector));
      children.forEach((child, index) => {
        child.classList.add('mv4-reveal-item');
        child.style.setProperty('--mv4-delay', `${Math.min(index * step, 180)}ms`);
      });
      if (individual) {
        children.forEach(child => groups.set(child, [child]));
      } else if (children.length) {
        groups.set(group, children);
      }
    }
  }

  addSequence('#ozellikler .section-heading, #jai .section-copy, #oyunlar .section-heading, #gelisim .section-heading, #sorular .section-heading', '.eyebrow, h2, p, .pill-button');
  addSequence('.feature-copy, .feature-small', '.small-label, h3, p');
  addSequence('.play-copy', '.eyebrow, h3, p');
  addSequence('.mini-levels', 'span', 45);
  addSequence('.level-journey', 'div', 35);
  addSequence('.game-tags', 'span', 35);
  addSequence('.faq-list', 'details', 50, true);
  addSequence('.progress-bottom', 'svg, p');

  // A brief waveform response and level-line draw are also one-shot effects.
  for (const bars of document.querySelectorAll('.sound-bars')) groups.set(bars, []);
  if (!nativeTimeline) {
    document.documentElement.classList.add('mv4-fallback');
    for (const scene of scenes) groups.set(scene, [...scene.querySelectorAll(':scope > .mv4-layer')]);
  }

  function clearEntrance(event) {
    if (!event.animationName.startsWith('mv4-')) return;
    event.target.classList.remove('mv4-enter', 'mv4-scene-enter');
  }
  document.addEventListener('animationend', clearEntrance);

  function configure() {
    observer?.disconnect();
    if (preference.matches) {
      document.querySelectorAll('.mv4-enter, .mv4-scene-enter').forEach(element => {
        element.classList.remove('mv4-enter', 'mv4-scene-enter');
      });
      return;
    }
    if (!('IntersectionObserver' in window)) return;

    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting || played.has(entry.target)) continue;
        const group = entry.target;
        played.add(group);
        observer.unobserve(group);
        // Keyboard focus makes the entire sequence immediately available.
        if (group.contains(document.activeElement)) continue;
        group.classList.add('mv4-sequence-played');
        for (const child of groups.get(group)) {
          child.classList.add(child.classList.contains('mv4-layer') ? 'mv4-scene-enter' : 'mv4-enter');
        }
      }
    }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });
    for (const group of groups.keys()) {
      if (!played.has(group)) observer.observe(group);
    }
  }

  preference.addEventListener('change', configure);
  configure();
})();
