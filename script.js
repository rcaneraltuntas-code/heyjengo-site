'use strict';
document.documentElement.classList.add('js');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const stage = document.querySelector('.hero-stage');
const sceneButtons = [...document.querySelectorAll('[data-scene]')];
const sceneImages = [...document.querySelectorAll('[data-hand]')];
const zones = [...document.querySelectorAll('[data-zone]')];
const notes = [
  [ ['JAI konuşmaya hazır', 'Bugün neler yaptığını İngilizce anlat.'], ['“Hi! How was your day?”', 'Sohbet bir “hello” ile başlar.'], ['Yeni bir kelime, yeni bir kapı', 'Kelimeleri konuşurken keşfet.'], ['Kendi hızında, kendi sesinle', 'Sesli veya yazılı pratik yap.'], ['Küçük adımlar. Büyük fark.', 'Günlük hedefini tamamlamaya yaklaş.'], ['Her gün biraz daha rahat', 'İngilizceyi alışkanlığa dönüştür.'] ],
  [ ['Siparişin hazır!', '“One pizza, please!”'], ['Bir tur daha?', 'Kelimeleri kullan, oyuna devam et.'], ['Hafızanı çalıştır', 'Kartları çevir, eşini bul.'], ['Doğru kelimeyi buldun', 'discover → keşfetmek'], ['Oynarken pratik yap', 'Her oyunda yeni bir fırsat.'], ['Sıradaki maceran', 'Kayıp Mücevher Vakası seni bekliyor.'] ],
  [ ['Her gün bir adım', 'Öğrenme yolculuğuna devam et.'], ['Kendi seviyenden başla', 'A1’den C2’ye ilerleyen dersler.'], ['Kelimeler seninle', 'Tekrar et, aklında kalsın.'], ['Bugünün emeğini gör', 'Günlük hedefini takip et.'], ['Serini devam ettir', 'Küçük alışkanlıklar birikir.'], ['Bir sonraki adım hazır', 'Kaldığın yerden devam et.'] ]
];
const captions = ['Konuşmaya başlamak bu kadar kolay.', 'Bir sipariş. Bir oyun. Biraz daha İngilizce.', 'Kendi yolculuğun. Her gün bir adım daha.'];
let currentScene = -1;
function setScene(index) {
  if (currentScene === index) return;
  currentScene = index;
  stage.dataset.phase = String(index);
  document.querySelector('.scrolly').classList.toggle('is-dark', index === 2);
  sceneButtons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.scene) === index)));
  sceneImages.forEach(img => {const active = Number(img.dataset.hand) === index; img.classList.toggle('is-active',active); img.setAttribute('aria-hidden',String(!active));});
  document.querySelector('#scene-label').textContent = captions[index];
  notes[index].forEach(([title, detail], i) => {document.querySelector(`[data-note-title="${i}"]`).textContent = title; document.querySelector(`[data-note-detail="${i}"]`).textContent = detail;});
  if (!reducedMotion.matches) {
    document.querySelectorAll('.notification').forEach((card, i) => {
      card.getAnimations().forEach(animation => animation.cancel());
      card.animate([{opacity:0.001,transform:'scale(.5)'},{opacity:1,transform:'scale(1)'}],{duration:500,delay:(i%3)*100,easing:'cubic-bezier(.2,.9,.25,1.12)',fill:'backwards'});
    });
  }
}
setScene(0);
// The hand and forearm enter together, independently of screen crossfades.
const handStack = document.querySelector('.hand-stack');
const handEntrance = new IntersectionObserver(entries => {
  if (entries.some(entry => entry.isIntersecting)) {
    handStack.classList.add('is-visible');
    handEntrance.disconnect();
  }
}, {threshold:.08});
handEntrance.observe(handStack);

// A one-pixel viewport-height band selects ordered scene intervals.
// No percentage rootMargins: their vertical percentages resolve to viewport width.
const scrolly = document.querySelector('.scrolly');
let zoneObserver;
let scrollStart = 0;
let scrollSpan = 1;
function reconcileScene() {
  if (reducedMotion.matches) return;
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-top'));
  const offset = top - scrolly.getBoundingClientRect().top;
  setScene(Math.min(2, Math.max(0, Math.floor(offset / scrollSpan * 3))));
}
function measureScene() {
  const headerBottom = document.querySelector('.site-header').getBoundingClientRect().bottom;
  const stickyTop = Math.ceil(headerBottom + 12);
  const viewportHeight = document.documentElement.clientHeight;
  document.documentElement.style.setProperty('--sticky-top', stickyTop + 'px');
  document.documentElement.style.setProperty('--stage-height', Math.max(220, viewportHeight - stickyTop) + 'px');
  const stageHeight = stage.offsetHeight;
  scrollSpan = Math.max(1, scrolly.offsetHeight - stageHeight);
  scrollStart = window.scrollY + scrolly.getBoundingClientRect().top - stickyTop;
  const first = stageHeight / 2 + scrollSpan / 3;
  zones[0].style.cssText = 'top:0;height:' + first + 'px';
  zones[1].style.cssText = 'top:' + first + 'px;height:' + scrollSpan / 3 + 'px';
  zones[2].style.cssText = 'top:' + (first + scrollSpan / 3) + 'px;bottom:0';
  zoneObserver?.disconnect();
  if (!reducedMotion.matches) {
    const line = Math.min(viewportHeight - 2, Math.round(stickyTop + stageHeight / 2));
    zoneObserver = new IntersectionObserver(reconcileScene, {
      rootMargin: `-${line}px 0px -${viewportHeight - line - 1}px 0px`, threshold: 0
    });
    zones.forEach(zone => zoneObserver.observe(zone));
    reconcileScene();
  }
}
sceneButtons.forEach(button => button.addEventListener('click', () => {
  const index = Number(button.dataset.scene);
  if (reducedMotion.matches) { setScene(index); return; }
  // The observer is the sole state writer during scroll, including tab navigation.
  window.scrollTo({top: scrollStart + scrollSpan * (index + .5) / 3, behavior: 'smooth'});
}));
// Reconcile endpoint jumps that skip the entire observer band.
let settleTimer;
document.addEventListener('scroll', () => {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(reconcileScene, 100);
}, {passive:true});
document.addEventListener('scrollend', reconcileScene);
window.addEventListener('resize', measureScene);
window.visualViewport?.addEventListener('resize', measureScene);
window.addEventListener('pageshow', measureScene);
reducedMotion.addEventListener('change', measureScene);
new ResizeObserver(measureScene).observe(document.querySelector('.hero-copy'));
measureScene();
const header = document.querySelector('.site-header');
const headerObserver = new IntersectionObserver(entries=>{const entry=entries[0];header.classList.toggle('compact',!entry.isIntersecting && entry.boundingClientRect.top<0);},{threshold:0});
headerObserver.observe(document.querySelector('.nav-sentinel'));
const revealObserver = new IntersectionObserver(entries=>entries.forEach(entry=>{
  if(entry.isIntersecting){entry.target.classList.add('in-view');if(!entry.target.classList.contains('chat-demo'))revealObserver.unobserve(entry.target);}
  else if(entry.target.classList.contains('chat-demo'))entry.target.classList.remove('in-view');
}),{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>revealObserver.observe(el));
document.querySelector('.announcement-close').addEventListener('click',()=>{document.querySelector('.announcement').hidden=true;document.querySelector('.announcement').style.display='none';document.body.classList.add('announcement-hidden');measureScene();});
const menuButton = document.querySelector('.menu-toggle');
const mobileMenu = document.querySelector('#mobile-nav');
function closeMenu(){mobileMenu.hidden=true;menuButton.setAttribute('aria-expanded','false');menuButton.setAttribute('aria-label','Menüyü aç');}
menuButton.addEventListener('click',()=>{const opening=mobileMenu.hidden;mobileMenu.hidden=!opening;menuButton.setAttribute('aria-expanded',String(opening));menuButton.setAttribute('aria-label',opening?'Menüyü kapat':'Menüyü aç');});
mobileMenu.querySelectorAll('a').forEach(link=>link.addEventListener('click',closeMenu));
document.addEventListener('keydown',event=>{if(event.key==='Escape' && !mobileMenu.hidden){closeMenu();menuButton.focus();}});
document.addEventListener('click',event=>{if(!header.contains(event.target))closeMenu();});
window.matchMedia('(min-width:790px)').addEventListener('change',event=>{if(event.matches)closeMenu();});
const answerButtons=[...document.querySelectorAll('[data-answer]')];
const feedback=document.querySelector('.quiz-feedback');
const reset=document.querySelector('.quiz-reset');
answerButtons.forEach(button=>button.addEventListener('click',()=>{
  answerButtons.forEach(b=>{b.classList.remove('correct','wrong');b.removeAttribute('aria-pressed');});
  const correct=button.dataset.answer==='correct';button.classList.add(correct?'correct':'wrong');button.setAttribute('aria-pressed','true');
  feedback.textContent=correct?'Evet! Discover, “keşfetmek” demek. Yeni bir kelime seninle.':'Bu kez olmadı. “Yeni bir şey bulmak” anlamını düşün ve tekrar dene.';
  feedback.style.color=correct?'#258047':'#a54338';reset.hidden=false;
}));
reset.addEventListener('click',()=>{answerButtons.forEach(b=>{b.classList.remove('correct','wrong');b.removeAttribute('aria-pressed');});feedback.textContent='Bir cevap seç ve dene.';feedback.style.color='';reset.hidden=true;answerButtons[0].focus();});
const dialog=document.querySelector('#preview-dialog');
const dialogContent=document.querySelector('#dialog-content');
document.querySelector('.dialog-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();}});
function conversationMarkup(){return `<div class="dialog-kicker">JAI · ÖRNEK KONUŞMA</div><h2 id="dialog-title">Bir kahve söyleyelim.</h2><p>Bu kısa örnekte cevabını seç. Gerçek uygulamada JAI ile sesli veya yazılı pratik yapabilirsin.</p><div class="dialog-chat" aria-live="polite"><div class="chat-bubble from-jai">Hi there! What would you like to drink?</div></div><div class="reply-options"><button data-reply="coffee">I’d like a cappuccino, please.</button><button data-reply="tea">Could I have a cup of tea?</button></div><small class="demo-note">Yerel örnek etkileşim · Mikrofon kaydı yapılmaz.</small>`;}
function bindConversation(){dialogContent.querySelectorAll('[data-reply]').forEach(button=>button.addEventListener('click',()=>{
 const chat=dialogContent.querySelector('.dialog-chat');const reply=document.createElement('div');reply.className='chat-bubble from-you';reply.textContent=button.textContent;chat.append(reply);
 const response=document.createElement('div');response.className='chat-bubble from-jai';response.textContent=button.dataset.reply==='coffee'?'Of course! One cappuccino. Would you like anything to eat?':'Absolutely! One cup of tea. Would you like lemon or milk?';chat.append(response);
 dialogContent.querySelector('.reply-options').remove();const again=document.createElement('button');again.className='dialog-reset';again.textContent='Konuşmayı yeniden başlat ↻';again.addEventListener('click',()=>{dialogContent.innerHTML=conversationMarkup();bindConversation();dialogContent.querySelector('[data-reply]').focus();});dialogContent.append(again);again.focus();
}));}
document.querySelectorAll('[data-open]').forEach(button=>button.addEventListener('click',()=>{
 closeMenu();
 if(button.dataset.open==='conversation'){dialogContent.innerHTML=conversationMarkup();bindConversation();}
 else {dialogContent.innerHTML=`<img class="dialog-icon" src="assets/app-icon.webp" alt="heyJengo"><div class="dialog-kicker">TASARIM SEÇENEĞİ 01</div><h2 id="dialog-title">heyJengo ile tanış.</h2><p>Bu sayfa, heyJengo için hazırlanan animasyonlu web tasarımı önizlemesi. App Store bağlantısı yayın aşamasında eklenecek.</p><p>Şimdilik JAI örneğini ve kelime oyununu bu sayfada deneyebilirsin.</p><button class="pill-button" id="dialog-explore">Örneği keşfet <svg class="icon"><use href="#arrow"/></svg></button>`;dialogContent.querySelector('#dialog-explore').addEventListener('click',()=>{dialog.close();document.querySelector('#jai').scrollIntoView({behavior:reducedMotion.matches?'instant':'smooth'});});}
 dialog.showModal();
}));
reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches){document.querySelectorAll('.notification').forEach(card=>card.getAnimations().forEach(animation=>animation.cancel()));}});
