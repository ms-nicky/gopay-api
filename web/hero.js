/**
 * Hero dengan scroll-scrub video.
 *
 * Port dari komponen React `scroll-locked-video-hero`, ditulis ulang untuk
 * halaman kasir ini: tanpa JSX, tanpa React, tanpa build step.
 *
 * Perbedaan penting dari sumber aslinya: lock di sini **ada** release valve.
 * Sumbernya mengunci halaman selama komponen hidup, sehingga form kasir tidak
 * pernah bisa disentuh. Di sini lock lepas begitu video selesai di-scrub, dan
 * menyala lagi kalau user scroll balik ke atas. Itu perilaku yang sebenarnya
 * dimaksud sumbernya; kodenya yang menyimpang dari niatnya.
 */

const KURVA_MULAI = 0.35;
const TAGLINE_MULAI = 0.82;
const LERP = 0.18;

const KURVA_HERO = {
  background: 'linear-gradient(180deg, rgba(5,7,13,0.4), rgba(5,7,13,0) 35%, rgba(5,7,13,0.5))',
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/** Ubah progress 0..1 jadi nilai yang sudah di-ease untuk tiap elemen. */
export function hitungKurva(progress) {
  const p = clamp(progress, 0, 1);
  return {
    judul: 1 - clamp(p / KURVA_MULAI, 0, 1),
    tagline: clamp((p - TAGLINE_MULAI) / (1 - TAGLINE_MULAI), 0, 1),
    video: 1 + p * 0.06,
    bar: p,
  };
}

/**
 * Kapan lock harus dilepas.
 *
 * Lepas hanya setelah progress penuh dan user masih mendorong ke bawah, jadi
 * satu gerakan scroll terus-menerus tidak memantulkan halaman balik ke atas.
 */
export function harusLepas(progress, deltaArah) {
  return progress >= 0.999 && deltaArah > 0;
}

/**
 * Arah scroll yang dianggap "ke bawah".
 *
 * Di roda mouse `deltaY` positif berarti ke bawah. Di touch, yang dipakai
 * `clientY` yang turun, jadi arahnya dibalik sebelum masuk ke sini.
 *
 * `deltaY` di dalam `WheelEvent` sudah negatif ke atas, tapi `deltaY` di
 * `WheelEvent` pada roda sentuh dan trackpad bisa非 wajib. Jadi ini bukan
 * penyesuaian yang bisa diandalkan untuk semua perangkat; yang dijamin benar
 * hanyalah tanda dari `clientY`.
 */
export const dariRoda = (deltaY) => deltaY;
export const dariSentuh = (selisihClientY) => selisihClientY;

export function pasangHero(root, opsi = {}) {
  if (!root) return () => {};

  const video = root.querySelector('[data-hero-video]');
  const judul = root.querySelector('[data-hero-judul]');
  const tagline = root.querySelector('[data-hero-tagline]');
  const hint = root.querySelector('[data-hero-hint]');
  const bar = root.querySelector('[data-hero-bar]');

  const jarakScrub = opsi.scrubDistance ?? 3200;
  const adaTagline = Boolean(tagline);
  const adaVideo = Boolean(video && video.getAttribute('src'));

  const kurangiGerak =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  let durasi = 0;
  let rafId = 0;
  let target = 0;
  let sekarang = 0;
  let sudahMulai = false;
  let sedangSeek = false;
  let antrianTime = null;
  let terkunci = false;
  let scrollSaatKunci = 0;
  let touchAwalY = 0;

  /**
   * Selesai mengunci, posisi scroll asli disimpan di `top` negatif supaya
   * halaman tidak meloncat saat lock dilepas. Tanpa ini, releasing lock
   * 항상 lompat ke atas.
   */
  function kunci() {
    if (terkunci) return;
    terkunci = true;
    scrollSaatKunci = window.scrollY;
    const s = document.body.style;
    s.position = 'fixed';
    s.top = `-${scrollSaatKunci}px`;
    s.left = '0';
    s.right = '0';
    s.width = '100%';
    s.overscrollBehavior = 'none';
  }

  function lepas() {
    if (!terkunci) return;
    terkunci = false;
    const s = document.body.style;
    s.position = '';
    s.top = '';
    s.left = '';
    s.right = '';
    s.width = '';
    s.overscrollBehavior = '';
    window.scrollTo(0, scrollSaatKunci);
  }

  function tambahDelta(delta) {
    const berikut = clamp(target + delta / jarakScrub, 0, 1);
    if (berikut !== target) {
      target = berikut;
      if (target > 0.001) sudahMulai = true;
    }
    return berikut;
  }

  function seekKe(t) {
    if (sedangSeek) {
      antrianTime = t;
      return;
    }
    sedangSeek = true;
    video.currentTime = t;
  }

  function gambar() {
    sekarang += (target - sekarang) * LERP;

    const k = hitungKurva(sekarang);

    if (video && durasi > 0) {
      seekKe(sekarang * durasi);
      video.style.transform = `scale(${k.video})`;
    }
    if (judul) {
      judul.style.opacity = String(k.judul);
      judul.style.transform = `translateY(${(1 - k.judul) * -24}px) scale(${0.96 + k.judul * 0.04})`;
      judul.style.filter = `blur(${(1 - k.judul) * 10}px)`;
    }
    if (tagline) {
      tagline.style.opacity = String(k.tagline);
      tagline.style.transform = `translateY(${(1 - k.tagline) * 20}px) scale(${0.97 + k.tagline * 0.03})`;
      tagline.style.filter = `blur(${(1 - k.tagline) * 8}px)`;
    }
    if (hint) hint.style.opacity = sudahMulai ? '0' : '1';
    if (bar) bar.style.transform = `scaleX(${k.bar})`;

    rafId = requestAnimationFrame(gambar);
  }

  const onRoda = (e) => {
    const delta = dariRoda(e.deltaY);
    tambahDelta(delta);
    if (harusLepas(target, delta)) {
      lepas();
      return;
    }
    e.preventDefault();
  };

  const onSentuhMulai = (e) => {
    touchAwalY = e.touches[0]?.clientY ?? 0;
  };

  const onSentuhGeser = (e) => {
    const y = e.touches[0]?.clientY ?? touchAwalY;
    const delta = dariSentuh(touchAwalY - y);
    touchAwalY = y;
    tambahDelta(delta);
    if (harusLepas(target, delta)) {
      lepas();
      return;
    }
    e.preventDefault();
  };

  /**
   * Lock hanya diaktifkan lewat input scroll atau touch. Mengunci halaman di
   * mount akan lebih/mybe én server-side atau saat halaman di-bookmark.
   */
  const onMasuk = (e) => {
    if (kurangiGerak) return;
    if (terkunci) return;
    kunci();
    if (e && e.deltaY !== 0) onRoda(e);
  };

  /**
   * Halaman terkunci berarti keyboard tidak bisa menggulir, jadi user keyboard
   * akan terjebak. Setiap tombol lepaskan lock supaya form kasir tetap bisa
   * dicapai tanpa mouse.
   */
  const onTombol = () => {
    if (terkunci) lepas();
  };

  /**
   * Fokus masuk ke elemen di luar hero juga melepas lock. Ini yang membuat hero
   * tidak jadi perangkap untuk navigasi keyboard dan pembaca layar.
   */
  const onFokusMasuk = (e) => {
    if (terkunci && !root.contains(e.target)) lepas();
  };

  if (!adaVideo) {
    // Tanpa video tidak ada yang bisa di-scrub, jadi mengunci halaman cuma
    // menyebalkan. Hero jadi panel statis dan halaman langsung normal. Listener
    // sengaja tidak dipasang sama sekali.
    root.classList.add('hero--statis');
    return () => {};
  }

  root.addEventListener('wheel', onMasuk, { passive: false });
  root.addEventListener('touchstart', onSentuhMulai, { passive: true, capture: true });
  root.addEventListener('touchmove', onSentuhGeser, { passive: false, capture: true });
  document.addEventListener('keydown', onTombol);
  document.addEventListener('focusin', onFokusMasuk);

  const onSiap = () => {
    durasi = video.duration || 0;
    root.classList.add('hero--siap');
    if (kurangiGerak) {
      video.currentTime = durasi * 0.92;
    }
  };

  const onSelesaiSeek = () => {
    sedangSeek = false;
    if (antrianTime !== null) {
      const t = antrianTime;
      antrianTime = null;
      sedangSeek = true;
      video.currentTime = t;
    }
  };

  video.addEventListener('loadeddata', onSiap);
  video.addEventListener('seeked', onSelesaiSeek);

  /**
   * iOS Safari tidak akan buffer video sampai playback benar-benar dimulai,
   * dan komponen ini hanya seek tanpa pernah play. Hasilnya video stays
   * permanen kosong di iPhone. Paksa play diam-diam sekali lalu pause.
   */
  const p = video.play();
  if (p && typeof p.then === 'function') {
    p.then(() => video.pause()).catch(() => {});
  } else {
    video.pause();
  }

  if (kurangiGerak) {
    video.currentTime = durasi * 0.92;
  } else {
    rafId = requestAnimationFrame(gambar);
  }

  if (adaTagline && kurangiGerak) {
    tagline.style.opacity = '1';
  }

  return () => {
    video.removeEventListener('loadeddata', onSiap);
    video.removeEventListener('seeked', onSelesaiSeek);
    root.removeEventListener('wheel', onMasuk, { passive: false });
    root.removeEventListener('touchstart', onSentuhMulai, true);
    root.removeEventListener('touchmove', onSentuhGeser, true);
    document.removeEventListener('keydown', onTombol);
    document.removeEventListener('focusin', onFokusMasuk);
    cancelAnimationFrame(rafId);
    lepas();
  };
}

export { KURVA_HERO };