(function () {
  'use strict';

  if (document.getElementById('heyjengo-consent')) return;

  const STORAGE_KEY = 'heyjengo:advertising-consent:v1';
  const VERSION = 1;
  const MAX_AGE = 180 * 24 * 60 * 60 * 1000;
  const PIXEL_ID = '1700618818126812';
  let preference = readPreference();
  let returnFocus = null;
  let pixelInitialized = false;
  let pageViewSent = false;
  let ownsPixelBootstrap = false;

  function parsePreference(value) {
    try {
      const saved = JSON.parse(value);
      const now = Date.now();
      return saved && saved.version === VERSION &&
        (saved.choice === 'accepted' || saved.choice === 'rejected') &&
        Number.isFinite(saved.timestamp) && saved.timestamp <= now &&
        now - saved.timestamp < MAX_AGE ? saved : null;
    } catch (_) {
      return null;
    }
  }

  function readPreference() {
    try {
      return parsePreference(window.localStorage.getItem(STORAGE_KEY));
    } catch (_) {
      return null;
    }
  }

  function enablePixel() {
    // Standard Meta base bootstrap runs only after an affirmative choice.
    if (!window.fbq) {
      (function (f, b, e, v, n, t, s) {
        n = f.fbq = function () {
          n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
        };
        if (!f._fbq) f._fbq = n;
        n.push = n;
        n.loaded = true;
        n.version = '2.0';
        n.queue = [];
        t = b.createElement(e);
        t.async = true;
        t.src = v;
        s = b.getElementsByTagName(e)[0];
        if (s) s.parentNode.insertBefore(t, s);
        else b.head.appendChild(t);
      })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      ownsPixelBootstrap = true;
    }
    if (typeof window.fbq !== 'function') return;
    window.fbq('consent', 'grant');
    if (!pixelInitialized) {
      window.fbq('set', 'autoConfig', false, PIXEL_ID);
      window.fbq('init', PIXEL_ID);
      pixelInitialized = true;
    }
    if (!pageViewSent) {
      window.fbq('track', 'PageView');
      pageViewSent = true;
    }
  }

  function disablePixel() {
    if (typeof window.fbq === 'function') {
      // A quick withdrawal must not replay a queued PageView when the SDK arrives.
      if (ownsPixelBootstrap && !window.fbq.callMethod && Array.isArray(window.fbq.queue)) {
        window.fbq.queue.length = 0;
        pixelInitialized = false;
        pageViewSent = false;
      }
      try { window.fbq('consent', 'revoke'); } catch (_) { /* Keep local choice usable. */ }
    }
    const host = window.location.hostname;
    const domains = ['', host, '.' + host];
    if (host === 'heyjengo.com' || host.endsWith('.heyjengo.com')) {
      domains.push('heyjengo.com', '.heyjengo.com');
    }
    const paths = new Set(['/']);
    const segments = window.location.pathname.split('/').filter(Boolean);
    segments.forEach((_, i) => {
      const path = '/' + segments.slice(0, i + 1).join('/');
      paths.add(path);
      paths.add(path + '/');
    });
    for (const name of ['_fbp', '_fbc']) {
      for (const path of paths) {
        for (const domain of new Set(domains)) {
          try {
            document.cookie = name + '=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=' +
              path + (domain ? '; Domain=' + domain : '') + '; SameSite=Lax';
          } catch (_) { /* Cookies may be blocked by the browser. */ }
        }
      }
    }
  }

  // Measure store intent only; clicks are not app installs or QR scans.
  document.querySelectorAll('a[data-store-placement]').forEach(link => {
    const placement = link.dataset.storePlacement;
    if (!['hero', 'qr_card', 'journey'].includes(placement)) return;
    const trackStoreClick = event => {
      if (event.defaultPrevented ||
          (event.type === 'click' && event.button !== 0) ||
          (event.type === 'auxclick' && event.button !== 1)) return;
      if (!parsePreference(JSON.stringify(preference)) || preference.choice !== 'accepted') return;
      if (typeof window.fbq !== 'function') return;
      try {
        window.fbq('trackCustom', placement === 'qr_card' ? 'QRCardClick' : 'AppStoreClick', {
          placement: placement,
          app_id: '6833951608',
          destination: 'app_store'
        });
      } catch (_) { /* Measurement must never block the App Store link. */ }
    };
    link.addEventListener('click', trackStoreClick);
    link.addEventListener('auxclick', trackStoreClick);
  });

  const panel = document.createElement('section');
  panel.id = 'heyjengo-consent';
  panel.className = 'consent-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'consent-title');
  panel.setAttribute('aria-describedby', 'consent-description');
  panel.innerHTML = '<div class="consent-panel__heading"><h2 id="consent-title">Reklam ölçümü tercihin</h2>' +
    '<button class="consent-panel__close" type="button" aria-label="Tercih panelini kapat" hidden>×</button></div>' +
    '<p id="consent-description">İzin verirsen ziyaretlerini ve App Store bağlantılarına tıklamalarını Meta Pixel ile ölçerek reklamlarımızın performansını değerlendirebiliriz. Reddedersen bu ölçüm yapılmaz.</p>' +
    '<a class="consent-panel__policy" href="/gizlilik/#web-cerezleri">Web sitesi çerezleri hakkında</a>' +
    '<div class="consent-panel__actions"><button type="button" data-consent-choice="accepted">Kabul et</button>' +
    '<button type="button" data-consent-choice="rejected">Reddet</button></div>';
  document.body.appendChild(panel);

  const closeButton = panel.querySelector('.consent-panel__close');
  const settingsButtons = document.querySelectorAll('[data-consent-settings]');

  function updateExpanded() {
    settingsButtons.forEach(button => {
      button.setAttribute('aria-controls', panel.id);
      button.setAttribute('aria-expanded', String(!panel.hidden));
    });
  }

  function closePanel() {
    if (!preference) return;
    const focusedInside = panel.contains(document.activeElement);
    panel.hidden = true;
    updateExpanded();
    const target = returnFocus || (focusedInside ? settingsButtons[0] : null);
    if (target && target.isConnected) target.focus({ preventScroll: true });
    returnFocus = null;
  }

  function choose(choice) {
    preference = { version: VERSION, choice: choice, timestamp: Date.now() };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference)); } catch (_) {
      // The current tab retains the choice when persistent storage is unavailable.
    }
    if (choice === 'accepted') enablePixel();
    else disablePixel();
    closeButton.hidden = false;
    closePanel();
  }

  panel.querySelectorAll('[data-consent-choice]').forEach(button => {
    button.addEventListener('click', () => choose(button.dataset.consentChoice));
  });
  settingsButtons.forEach(button => {
    button.addEventListener('click', () => {
      returnFocus = button;
      panel.hidden = false;
      closeButton.hidden = !preference;
      updateExpanded();
      const choice = preference ? preference.choice : 'rejected';
      panel.querySelector('[data-consent-choice="' + choice + '"]').focus({ preventScroll: true });
    });
  });
  closeButton.addEventListener('click', closePanel);
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape' && preference) {
      event.preventDefault();
      closePanel();
    }
  });
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    preference = parsePreference(event.key === null ? null : event.newValue);
    if (preference && preference.choice === 'accepted') enablePixel();
    else disablePixel();
    closeButton.hidden = !preference;
    if (preference) closePanel();
    else { panel.hidden = false; updateExpanded(); }
  });

  panel.hidden = Boolean(preference);
  closeButton.hidden = !preference;
  updateExpanded();
  if (preference && preference.choice === 'accepted') enablePixel();
  else disablePixel();
})();
