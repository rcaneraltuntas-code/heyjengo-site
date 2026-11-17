(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reveals = [...document.querySelectorAll('.reveal')];
  const movingRegions = [...document.querySelectorAll('.hero-art, .tile-listen, .qr-download')];
  const regionVisibility = new Map();
  let screenTransition = null;

  function updateMotion() {
    movingRegions.forEach((region) => {
      region.classList.toggle('is-inview', Boolean(regionVisibility.get(region)) &&
        !reducedMotion.matches && !document.hidden);
    });
    if (reducedMotion.matches) {
      reveals.forEach((element) => element.classList.add('is-visible'));
      screenTransition?.cancel();
    }
  }

  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting) return;
        target.classList.add('is-visible');
        revealObserver.unobserve(target);
      });
    }, { threshold: 0.12 });
    reveals.forEach((element) => revealObserver.observe(element));

    const motionObserver = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => regionVisibility.set(target, isIntersecting));
      updateMotion();
    });
    movingRegions.forEach((region) => motionObserver.observe(region));
  } else {
    // Content stays available without observers; decorative loops remain paused.
    reveals.forEach((element) => element.classList.add('is-visible'));
  }
  reducedMotion.addEventListener('change', updateMotion);
  document.addEventListener('visibilitychange', updateMotion);
  updateMotion();
  document.documentElement.classList.add('js');

  const screen = document.getElementById('hero-screen');
  const screenButtons = [...document.querySelectorAll('.screen-selector [data-screen]')];
  const screens = {
    '09-home-learn': { alt: 'heyJengo ana öğrenme ekranı', label: 'Öğren' },
    '58-jai-chat': { alt: 'JAI ile İngilizce sohbet ekranı', label: 'Konuş' },
    '37-game-pizza': { alt: 'Pizza Dükkânı İngilizce sipariş oyunu', label: 'Oyna' }
  };
  let screenRequest = 0;

  if (screen && screenButtons.length) {
    const screenStatus = document.createElement('span');
    screenStatus.className = 'sr-only';
    screenStatus.setAttribute('role', 'status');
    document.querySelector('.screen-selector').append(screenStatus);

    screenButtons.forEach((button) => {
      button.setAttribute('aria-controls', screen.id);
      button.addEventListener('click', async () => {
        const key = button.dataset.screen;
        if (!screens[key]) return;
        const request = ++screenRequest;
        const image = new Image();
        image.src = `assets/screens/${key}.png`;
        screen.setAttribute('aria-busy', 'true');
        try {
          await image.decode();
          if (request !== screenRequest) return;

          screenTransition?.cancel();
          // Keep the previous image over the decoded next image: never fade to an empty display.
          const previous = screen.cloneNode(false);
          previous.removeAttribute('id');
          previous.removeAttribute('aria-busy');
          previous.setAttribute('aria-hidden', 'true');
          previous.alt = '';
          previous.className = 'screen-transition';
          previous.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top;pointer-events:none;';

          screen.src = image.src;
          screen.alt = screens[key].alt;
          screenButtons.forEach((item) => {
            const selected = item === button;
            item.classList.toggle('active', selected);
            item.setAttribute('aria-pressed', String(selected));
          });
          screenStatus.textContent = `${screens[key].label} ekranı gösteriliyor.`;

          if (!reducedMotion.matches && typeof previous.animate === 'function') {
            screen.parentElement.append(previous);
            const animation = previous.animate([{ opacity: 1 }, { opacity: 0 }], {
              duration: 180, easing: 'ease-out'
            });
            screenTransition = animation;
            const cleanup = () => {
              previous.remove();
              if (screenTransition === animation) screenTransition = null;
            };
            animation.onfinish = cleanup;
            animation.oncancel = cleanup;
          }
        } catch {
          if (request === screenRequest) {
            screenStatus.textContent = 'Ekran yüklenemedi. Mevcut ekran korunuyor; yeniden deneyebilirsin.';
          }
        } finally {
          if (request === screenRequest) screen.removeAttribute('aria-busy');
        }
      });
    });
  }

  const dialogs = new Map(['conversation', 'quiz'].map((name) => [
    name, document.getElementById(`${name}-dialog`)
  ]));
  const dialogState = new WeakMap();
  const openDialogs = () => [...dialogs.values()].filter((dialog) => dialog?.open);
  const updateDialogBody = () => document.body.classList.toggle('dialog-open', openDialogs().length > 0);

  function openDialog(name, trigger) {
    const dialog = dialogs.get(name);
    if (!dialog || dialog.open) return;
    const current = openDialogs().at(-1);
    const returnFocus = current ? dialogState.get(current)?.returnFocus : trigger;
    dialogState.set(dialog, { returnFocus });
    // Open the destination first so the old dialog's close event cannot steal its focus.
    dialog.showModal();
    current?.close();
    updateDialogBody();
    dialog.querySelector('.dialog-close')?.focus({ preventScroll: true });
  }

  document.querySelectorAll('[data-open], [data-switch]').forEach((button) => {
    const name = button.dataset.open || button.dataset.switch;
    const dialog = dialogs.get(name);
    if (!dialog) return;
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', dialog.id);
    button.addEventListener('click', () => openDialog(name, button));
  });

  dialogs.forEach((dialog) => {
    if (!dialog) return;
    dialog.querySelector('.dialog-close')?.addEventListener('click', () => dialog.close());
    let pressedBackdrop = false;
    const outside = (event) => {
      const rect = dialog.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom;
    };
    dialog.addEventListener('pointerdown', (event) => {
      pressedBackdrop = event.target === dialog && outside(event);
    });
    dialog.addEventListener('click', (event) => {
      if (pressedBackdrop && event.target === dialog && outside(event)) dialog.close();
      pressedBackdrop = false;
    });
    dialog.addEventListener('close', () => {
      updateDialogBody();
      if (dialog.open || openDialogs().length) return;
      const trigger = dialogState.get(dialog)?.returnFocus;
      if (trigger?.isConnected && !trigger.closest('dialog:not([open])')) {
        trigger.focus({ preventScroll: true });
      }
    });
    // Escape and the modal focus boundary are handled by the native dialog element.
  });

  const chat = document.querySelector('.demo-chat');
  const replyOptions = document.querySelector('.reply-options');
  const resetChat = document.querySelector('.reset-chat');
  const replies = {
    coffee: {
      question: 'Could I have a latte, please?',
      answer: 'Of course! Would you like a small or a large latte?'
    },
    travel: {
      question: 'How do I get to the train station?',
      answer: 'Go straight ahead, then turn left. The station is on your right. Where are you travelling today?'
    },
    day: {
      question: 'Can I tell you about my day?',
      answer: 'Of course! What was the best part of your day?'
    }
  };

  function message(text, user = false) {
    const paragraph = document.createElement('p');
    paragraph.className = user ? 'message user' : 'message';
    const speaker = document.createElement('span');
    speaker.className = 'sr-only';
    speaker.textContent = user ? 'Sen: ' : 'JAI: ';
    const sentence = document.createElement('span');
    sentence.lang = 'en';
    sentence.textContent = text;
    paragraph.append(speaker, sentence);
    return paragraph;
  }

  if (chat && replyOptions && resetChat) {
    const greeting = chat.textContent.trim();
    chat.replaceChildren(message(greeting));
    chat.setAttribute('aria-live', 'polite');
    chat.setAttribute('aria-relevant', 'additions');
    let answered = false;
    replyOptions.querySelectorAll('[data-reply]').forEach((button) => {
      button.addEventListener('click', () => {
        const reply = replies[button.dataset.reply];
        if (!reply || answered) return;
        answered = true;
        chat.append(message(reply.question, true), message(reply.answer));
        replyOptions.hidden = true;
        resetChat.hidden = false;
        resetChat.focus({ preventScroll: true });
      });
    });
    resetChat.addEventListener('click', () => {
      answered = false;
      chat.replaceChildren(message(greeting));
      replyOptions.hidden = false;
      resetChat.hidden = true;
      replyOptions.querySelector('button')?.focus({ preventScroll: true });
    });
  }

  const quizButtons = [...document.querySelectorAll('.quiz-choices [data-answer]')];
  const quizFeedback = document.querySelector('.quiz-feedback');
  const quizReset = document.querySelector('.quiz-reset');
  if (quizFeedback && quizReset && quizButtons.length) {
    quizFeedback.id = 'quiz-feedback';
    quizButtons.forEach((button) => {
      button.setAttribute('aria-describedby', quizFeedback.id);
      button.addEventListener('click', () => {
        if (button.disabled) return;
        const correct = button.dataset.answer === 'correct';
        button.classList.add(correct ? 'correct' : 'wrong');
        quizButtons.forEach((choice) => {
          choice.disabled = true;
          choice.setAttribute('aria-pressed', String(choice === button));
        });
        quizFeedback.classList.toggle('correct', correct);
        quizFeedback.classList.toggle('wrong', !correct);
        quizFeedback.textContent = correct
          ? 'Doğru! “Discover”, “keşfetmek” demek. Bir yeni kelime daha!'
          : 'Henüz değil. “Discover”, “keşfetmek” demek. Bir kez daha deneyebilirsin.';
        quizReset.hidden = false;
        quizReset.focus({ preventScroll: true });
      });
    });
    quizReset.addEventListener('click', () => {
      quizButtons.forEach((button) => {
        button.disabled = false;
        button.classList.remove('correct', 'wrong');
        button.removeAttribute('aria-pressed');
      });
      quizFeedback.classList.remove('correct', 'wrong');
      quizFeedback.textContent = 'Bir cevap seç.';
      quizReset.hidden = true;
      quizButtons[0].focus({ preventScroll: true });
    });
  }
})();
