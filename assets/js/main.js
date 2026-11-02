/* 中根研究室サイト 共通スクリプト（デザイン案: 研究室の学生 / 動画リストは _data/videos.yml） */
(function () {
  var root = document.documentElement;
  root.classList.add('js');

  // ===== 動画リスト：ここに YouTube の動画を追加するとギャラリーに並びます =====
  // id は https://www.youtube.com/watch?v=XXXXXXXXXXX の XXXXXXXXXXX 部分
  var CHANNEL = 'https://www.youtube.com/channel/UCpgRsoOOei7fWkbZAa9eUtg';
  var UPLOADS = 'UUpgRsoOOei7fWkbZAa9eUtg'; // チャンネル全動画のプレイリスト
  var VIDEOS = window.LAB_VIDEOS || [];

  // Language
  function setLang(l) {
    root.dataset.lang = l; root.lang = l;
    try { localStorage.setItem('lang', l); } catch (e) {}
    var b = document.getElementById('lang-btn');
    if (b) b.textContent = l === 'ja' ? 'English' : '日本語';
  }
  var saved = null;
  try { saved = localStorage.getItem('lang'); } catch (e) {}
  setLang(saved || ((navigator.language || 'ja').indexOf('ja') === 0 ? 'ja' : 'en'));
  document.getElementById('lang-btn').addEventListener('click', function () {
    setLang(root.dataset.lang === 'ja' ? 'en' : 'ja');
  });

  // Mobile menu
  var menuBtn = document.getElementById('menu-btn');
  if (menuBtn) {
    menuBtn.addEventListener('click', function () {
      var open = document.body.classList.toggle('menu-open');
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.querySelectorAll('#nav-links a').forEach(function (a) {
      a.addEventListener('click', function () { document.body.classList.remove('menu-open'); menuBtn.setAttribute('aria-expanded', 'false'); });
    });
  }

  // Video facades: show a thumbnail, load the player only when clicked
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function facade(opts) {
    var thumb = opts.id ? '<img src="https://i.ytimg.com/vi/' + opts.id + '/hqdefault.jpg" alt="" loading="lazy" onerror="this.remove()">' : '';
    return '<button class="yt" type="button" data-id="' + (opts.id || '') + '" data-list="' + (opts.list || '') + '" aria-label="' + esc(opts.label) + '">' +
      thumb + '<span class="pbtn" aria-hidden="true"></span>' + (opts.cap || '') + '</button>';
  }
  var gallery = document.getElementById('gallery');
  if (gallery && !gallery.children.length) {
    var html = '<article class="vcard all reveal">' + facade({ list: UPLOADS, label: 'Play all videos',
      cap: '<span class="cap"><span lang="ja">全動画を連続再生</span><span lang="en">Play all</span></span>' }) +
      '<h3><span lang="ja">チャンネルの全動画</span><span lang="en">Every video on our channel</span></h3>' +
      '<p><span lang="ja">新しい動画も自動でここに並びます。</span><span lang="en">New uploads appear here automatically.</span></p></article>';
    VIDEOS.forEach(function (v) {
      html += '<article class="vcard reveal">' + facade({ id: v.id, label: v.en }) +
        '<h3><span lang="ja">' + esc(v.ja) + '</span><span lang="en">' + esc(v.en) + '</span></h3>' +
        '<p><span lang="ja">' + esc(v.dja || '') + '</span><span lang="en">' + esc(v.den || '') + '</span></p></article>';
    });
    gallery.innerHTML = html;
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.yt');
    if (!b || window.NO_EMBED) return;   // NO_EMBED: プレビュー環境ではリンクとして YouTube を開く
    e.preventDefault();
    var src = b.dataset.list
      ? 'https://www.youtube-nocookie.com/embed/videoseries?list=' + b.dataset.list + '&autoplay=1'
      : 'https://www.youtube-nocookie.com/embed/' + b.dataset.id + '?autoplay=1&rel=0';
    var f = document.createElement('iframe');
    f.src = src; f.title = b.getAttribute('aria-label') || 'YouTube';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    var wrap = document.createElement('div');
    wrap.className = 'yt'; wrap.appendChild(f);
    b.replaceWith(wrap);
  });
  document.querySelectorAll('[data-channel]').forEach(function (a) { a.href = CHANNEL; });

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Character carousel: swipe / arrows / thumbnails
  var stage = document.getElementById('stage');
  if (stage) {
    var slides = stage.querySelectorAll('.slide');
    var thumbs = document.querySelectorAll('.thumbs button');
    var counter = document.getElementById('cast-count');
    function current() { return Math.round(stage.scrollLeft / stage.clientWidth); }
    function go(i) {
      i = (i + slides.length) % slides.length;
      stage.scrollTo({ left: i * stage.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
    }
    function sync() {
      var i = current();
      thumbs.forEach(function (t, k) { t.setAttribute('aria-current', k === i ? 'true' : 'false'); });
      var row = thumbs[i] && thumbs[i].parentNode;
      if (row && row.scrollWidth > row.clientWidth) row.scrollTo({ left: thumbs[i].offsetLeft - row.clientWidth / 2 + thumbs[i].offsetWidth / 2, behavior: 'smooth' });
      if (counter) counter.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0');
    }
    document.getElementById('cast-prev').addEventListener('click', function () { go(current() - 1); });
    document.getElementById('cast-next').addEventListener('click', function () { go(current() + 1); });
    thumbs.forEach(function (t, k) { t.addEventListener('click', function () { go(k); }); });
    stage.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { go(current() + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { go(current() - 1); e.preventDefault(); }
    });
    var tid; stage.addEventListener('scroll', function () { clearTimeout(tid); tid = setTimeout(sync, 60); });
    sync();
  }

  // Reveal sections below the fold
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.remove('pending'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.reveal').forEach(function (el) {
      if (el.getBoundingClientRect().top > window.innerHeight) { el.classList.add('pending'); io.observe(el); }
    });
  }

  // Hero wordmark: each syllable is built by a different microbe, arriving the way it really moves
  //   Na  = the letters glow like a light; green cyanobacteria twitch in from the right on type IV pili
  //   ka  = many narrow channels open up; drill bacteria (wrapped flagella) come through them from the right
  //         and stop where the letters will be, so the letters appear where they stop
  //   ne  = water flows to the right; pili bacteria and Mycoplasma swim upstream and stop at the letters
  //   Lab = gliding, peritrichous, monotrichous and amphitrichous (Campylobacter, Helicobacter) bacteria
  //         and algae arrive from every direction
  var cv = document.getElementById('wordmark');
  if (!cv) return;
  var ctx = cv.getContext('2d');
  // The logo always plays once: Windows turns on "reduce motion" whenever its animation effects are off,
  // which left Edge users with only the still logo. It is short, plays once and never loops.
  var still = false, raf = 0, started = false;
  var INK = '#1D3A34', GREEN = '#3BA57A', COBALT = '#2F6FE0', PINK = '#E2557A', MUSTARD = '#F0A500';
  var W, H, cells = [], t0 = null, ghost = null, zones = {};
  // one act per group, in reading order
  var ACT = { na: 0, ka: 2.4, ne: 5.6, lab: 8.0 }, ARRIVE = 2.0, END = 10.8;
  var NEXT = { na: ACT.ka, ka: ACT.ne, ne: ACT.lab, lab: END };
  var SETTLE = { na: ARRIVE, ka: 3.0, ne: 2.4, lab: ARRIVE };   // when each group's letters fill in
  var lanes = [];
  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(v) { v = clamp(v); return 1 - Math.pow(1 - v, 3); }
  var legend = document.querySelectorAll('.legend li[data-g]');
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  function layout() {
    var mobile = W < 640;
    var off = document.createElement('canvas'), o = off.getContext('2d');
    off.width = W; off.height = H;
    // heavy letters give the cells room; letter spacing keeps neighbours apart
    var font = function (s) { return '900 ' + s + 'px "Zen Maru Gothic","Hiragino Maru Gothic ProN","Arial Rounded MT Bold",sans-serif'; };
    // segments: [text, group]
    var rows = mobile ? [[['Na', 'na'], ['ka', 'ka'], ['ne', 'ne']], [['Lab', 'lab']]]
                      : [[['Na', 'na'], ['ka', 'ka'], ['ne', 'ne'], [' ', null], ['Lab', 'lab']]];
    var TRACK = 0.09;                                       // extra space between letters, as a share of the size
    function segWidth(t, s) { var w = 0; for (var q = 0; q < t.length; q++) w += o.measureText(t[q]).width + s * TRACK; return w; }
    var size = 100; o.font = font(size);
    var widest = Math.max.apply(null, rows.map(function (r) { return r.reduce(function (a, g) { return a + segWidth(g[0], 100); }, 0); }));
    size = Math.min(100 * W * 0.92 / widest, H * 0.9 / rows.length);
    o.font = font(size); o.textBaseline = 'middle';
    var masks = {}, draws = [];
    rows.forEach(function (r, k) {
      var total = r.reduce(function (a, g) { return a + segWidth(g[0], size); }, 0);
      var x = (W - total) / 2, y = H / 2 + (k - (rows.length - 1) / 2) * size * 0.98;
      r.forEach(function (g) {
        var w = segWidth(g[0], size);
        if (g[1]) {
          o.clearRect(0, 0, W, H);
          var cx = x;
          for (var q = 0; q < g[0].length; q++) { o.fillText(g[0][q], cx, y); draws.push([g[0][q], cx, y, g[1]]); cx += o.measureText(g[0][q]).width + size * TRACK; }
          masks[g[1]] = o.getImageData(0, 0, W, H).data;
          zones[g[1]] = { x0: x, x1: x + w, y: y };
        }
        x += w;
      });
    });
    ghost = { font: font(size), draws: draws, size: size };
    // pack the inside of each letter with cells (offset rows), so the microbes alone spell the word
    var step = Math.max(5, Math.round(size / 15));
    var pts = [];
    Object.keys(masks).forEach(function (grp) {
      var d = masks[grp];
      function ins(x, y) { return x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] > 128; }
      for (var y = 0, row = 0; y < H; y += step * 0.86, row++) for (var x = (row % 2) * step / 2; x < W; x += step) {
        var xi = Math.round(x), yi = Math.round(y);
        if (ins(xi, yi)) pts.push([x + rnd(-1, 1), y + rnd(-1, 1), grp]);
      }
    });
    return { pts: pts, r: step * 0.55 };
  }

  var KINDS = { na: ['cyano', 'cyanorod'], ka: ['drill'], ne: ['pili', 'pili', 'myco'], lab: ['glider', 'glider', 'peri', 'mono', 'campy', 'labpili', 'coccus', 'chlamy', 'diatom', 'euglena', 'spiro', 'parame'] };
  var POP = ['#F0A500', '#9FC3F5', '#E2557A', '#8C6BE0', '#3BA57A', '#FF8A3D', '#4CC3C9', '#FFFFFF'];   // Lab's mixed colours
  function build() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    zones = {};
    var L = layout(); cells = [];
    var R = Math.max(W, H) * 0.75;
    L.pts.forEach(function (p) {
      var g = p[2], z = zones[g], c = { tx: p[0], ty: p[1], g: g, kind: pick(KINDS[g]), col: pick(POP), r: L.r * rnd(0.85, 1.1), ph: rnd(0, 10), delay: ACT[g] + rnd(0, 0.5) };
      var cx = (z.x0 + z.x1) / 2, ang = rnd(0, 6.28);
      if (g === 'lab') { c.x = cx + Math.cos(ang) * R; c.y = z.y + Math.sin(ang) * R; }                 // from every direction
      else if (g === 'na') { c.x = W + rnd(20, W * 0.4); c.y = c.ty + rnd(-H * 0.35, H * 0.35); }      // in from the right, toward the light
      else if (g === 'ka') { c.sx = W + rnd(20, W * 0.3); c.delay = ACT.ka + 0.4 + rnd(0, 0.6); c.x = c.sx; c.y = c.ty; }
      else { c.sx = W + rnd(20, W * 0.35); c.x = c.sx; c.y = c.ty; }                                    // downstream, to the right
      c.a = Math.atan2(c.ty - c.y, c.tx - c.x);
      cells.push(c);
    });
    // a handful of narrow channels, well apart, running from the right edge to just right of "ka";
    // each drill bacterium rides the nearest one in single file, then leaves the mouth for its spot
    lanes = [];
    var kc = cells.filter(function (c) { return c.g === 'ka'; });
    if (kc.length && zones.ka) {
      var y0 = Math.min.apply(null, kc.map(function (c) { return c.ty; })), y1 = Math.max.apply(null, kc.map(function (c) { return c.ty; }));
      var n = Math.max(3, Math.min(7, Math.floor((y1 - y0) / (L.r * 3.4)) + 1));
      for (var li = 0; li < n; li++) lanes.push({ x: zones.ka.x1 + L.r * 2, y: n === 1 ? (y0 + y1) / 2 : y0 + (y1 - y0) * li / (n - 1), h: L.r * 0.75 });
      kc.forEach(function (c) {
        c.lane = lanes.reduce(function (b, l) { return Math.abs(l.y - c.ty) < Math.abs(b.y - c.ty) ? l : b; });
        c.y = c.lane.y;
      });
    }
    t0 = null;
  }

  function rod(r, w) { var L = r * 0.9, h = r * (w || 0.5); ctx.moveTo(-L, -h); ctx.lineTo(L, -h); ctx.arc(L, 0, h, -Math.PI / 2, Math.PI / 2); ctx.lineTo(-L, h); ctx.arc(-L, 0, h, Math.PI / 2, Math.PI * 1.5); }
  function tail(x0, dir, r, t, ph, len, amp) { ctx.beginPath(); ctx.moveTo(x0, 0); for (var q = 1; q <= 7; q++) ctx.lineTo(x0 + dir * q * r * (len || 0.2), Math.sin(q * 1.3 + t * 0.014 + ph) * r * (amp || 0.22)); ctx.lineWidth = 1; ctx.stroke(); }
  // type IV pili: several fibres fan out from the front pole, each extending and retracting on its own rhythm
  function pili(r, w, t, ph) {
    var h = r * w;
    ctx.beginPath();
    for (var k = 0; k < 5; k++) {
      var a = (k - 2) * 0.32;                                                             // fixed directions: no swinging
      var len = r * (0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * (0.0022 + k * 0.0004) + ph * (k + 1))));   // slow, smooth extend / retract
      var x0 = r * 0.9 + Math.cos(a) * h, y0 = Math.sin(a) * h;
      ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
    }
    ctx.lineWidth = 1; ctx.stroke();
  }
  function shape(c, t) {
    var r = c.r;
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
    ctx.lineWidth = 1.4; ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    switch (c.kind) {
      case 'cyano': // green cocci with pili reaching toward the light
        ctx.arc(0, 0, r * 0.62, 0, 6.28); ctx.fillStyle = GREEN; ctx.fill(); ctx.stroke();
        ctx.beginPath(); for (var k = -1; k <= 1; k++) { ctx.moveTo(r * 0.55, k * r * 0.3); ctx.lineTo(r * (1.1 + 0.15 * Math.sin(t * 0.02 + c.ph + k)), k * r * 0.45); }
        ctx.lineWidth = 1; ctx.stroke(); break;
      case 'cyanorod': // rod-shaped cyanobacterium, pili out front toward the light
        rod(r * 0.9, 0.5); ctx.fillStyle = '#2E9468'; ctx.fill(); ctx.stroke();
        ctx.beginPath(); for (var kr = -1; kr <= 1; kr++) { ctx.moveTo(r * 1.15, kr * r * 0.2); ctx.lineTo(r * (1.6 + 0.15 * Math.sin(t * 0.02 + c.ph + kr)), kr * r * 0.4); }
        ctx.lineWidth = 1; ctx.stroke(); break;
      case 'drill': // rod with the flagellum wrapped around the body like a screw
        rod(r, 0.48); ctx.fillStyle = COBALT; ctx.fill(); ctx.stroke();
        ctx.beginPath(); for (var s = 0; s <= 14; s++) { var xx = -r * 1.2 + s * r * 2.4 / 14; var yy = Math.sin(s * 1.6 + t * 0.03 + c.ph) * r * 0.62; s ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = Math.max(0.6, r * 0.14); ctx.stroke(); break;
      case 'pili': // rod pulling itself forward with front pili
        rod(r, 0.46); ctx.fillStyle = PINK; ctx.fill(); ctx.stroke();
        pili(r, 0.46, t, c.ph); break;
      case 'myco': // flask-shaped Mycoplasma, head first
        ctx.moveTo(r * 1.1, 0); ctx.quadraticCurveTo(r * 0.4, -r * 0.35, -r * 0.2, -r * 0.6); ctx.arc(-r * 0.4, 0, r * 0.62, -Math.PI / 2.6, Math.PI / 2.6, true);
        ctx.quadraticCurveTo(r * 0.4, r * 0.35, r * 1.1, 0); ctx.fillStyle = '#F7B6C6'; ctx.fill(); ctx.stroke(); break;
      case 'glider':
        rod(r * 1.2, 0.3); ctx.fillStyle = c.col; ctx.fill(); ctx.stroke(); break;
      case 'peri': // flagella all around
        rod(r, 0.5); ctx.fillStyle = c.col; ctx.fill(); ctx.stroke();
        ctx.strokeStyle = INK; for (var p = -1; p <= 1; p += 2) for (var q2 = -1; q2 <= 1; q2++) { ctx.save(); ctx.translate(q2 * r * 0.6, p * r * 0.5); ctx.rotate(p * 2.4); tail(0, 1, r * 0.6, t, c.ph + q2, 0.25, 0.3); ctx.restore(); }
        break;
      case 'mono': // rod with a single polar flagellum
        rod(r, 0.48); ctx.fillStyle = c.col; ctx.fill(); ctx.stroke();
        ctx.strokeStyle = INK; tail(-r * 1.35, -1, r * 1.3, t, c.ph, 0.22, 0.25); break;
      case 'campy': // spiral S with a flagellum at each pole
        for (var s2 = 0; s2 <= 12; s2++) { var x2 = -r + s2 * r / 6, y2 = Math.sin(s2 * 0.8) * r * 0.35; s2 ? ctx.lineTo(x2, y2) : ctx.moveTo(x2, y2); }
        ctx.lineWidth = r * 0.4; ctx.strokeStyle = INK; ctx.stroke();
        ctx.beginPath(); for (var s3 = 0; s3 <= 12; s3++) { var x3 = -r + s3 * r / 6, y3 = Math.sin(s3 * 0.8) * r * 0.35; s3 ? ctx.lineTo(x3, y3) : ctx.moveTo(x3, y3); }
        ctx.lineWidth = r * 0.18; ctx.strokeStyle = MUSTARD; ctx.stroke(); ctx.strokeStyle = INK;
        tail(r, 1, r, t, c.ph); tail(-r, -1, r, t, c.ph + 2); break;
      case 'labpili': // rod with type IV pili at the front
        rod(r, 0.46); ctx.fillStyle = c.col; ctx.fill(); ctx.stroke();
        pili(r, 0.46, t, c.ph); break;
      case 'coccus': // small chain of round cells
        for (var cc = -1; cc <= 1; cc++) { ctx.beginPath(); ctx.arc(cc * r * 0.62, 0, r * 0.34, 0, 6.28); ctx.fillStyle = c.col; ctx.fill(); ctx.stroke(); }
        break;
      case 'diatom': // boat-shaped diatom with a centre line, gliding
        ctx.ellipse(0, 0, r * 1.2, r * 0.42, 0, 0, 6.28); ctx.fillStyle = '#E8C46A'; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-r * 0.9, 0); ctx.lineTo(r * 0.9, 0); for (var dd = -3; dd <= 3; dd++) { ctx.moveTo(dd * r * 0.25, -r * 0.3); ctx.lineTo(dd * r * 0.25, r * 0.3); } ctx.lineWidth = 0.7; ctx.stroke(); break;
      case 'spiro': // Spiroplasma: thin helix whose kinks travel along the body
        ctx.moveTo(-r * 1.2, 0); for (var sq = 1; sq <= 16; sq++) ctx.lineTo(-r * 1.2 + sq * r * 0.15, Math.sin(sq * 1.2 - t * 0.02 + c.ph) * r * 0.32);
        ctx.lineWidth = Math.max(2.4, r * 0.38); ctx.stroke(); ctx.lineWidth = Math.max(1.2, r * 0.2); ctx.strokeStyle = c.col; ctx.stroke(); break;
      case 'parame': // Paramecium: slipper-shaped ciliate with an oral groove, cilia beating all round
        ctx.moveTo(r * 1.3, 0); ctx.bezierCurveTo(r * 1.1, -r * 0.75, -r * 1.1, -r * 0.75, -r * 1.3, 0); ctx.bezierCurveTo(-r * 1.1, r * 0.7, -r * 0.1, r * 0.35, r * 0.1, r * 0.5); ctx.bezierCurveTo(r * 0.4, r * 0.7, r * 1.2, r * 0.5, r * 1.3, 0);
        ctx.fillStyle = c.col; ctx.fill(); ctx.stroke();
        ctx.beginPath(); for (var cq = 0; cq < 18; cq++) { var ca = cq / 18 * 6.28, cb = Math.sin(t * 0.03 + cq * 0.8 + c.ph) * 0.25, ex = Math.cos(ca) * r * 1.25, ey = Math.sin(ca) * r * 0.62; ctx.moveTo(ex, ey); ctx.lineTo(ex + Math.cos(ca + cb) * r * 0.3, ey + Math.sin(ca + cb) * r * 0.3); }
        ctx.lineWidth = 0.8; ctx.stroke();
        ctx.beginPath(); ctx.arc(-r * 0.2, -r * 0.1, r * 0.18, 0, 6.28); ctx.fillStyle = INK; var ga = ctx.globalAlpha; ctx.globalAlpha = ga * 0.35; ctx.fill(); ctx.globalAlpha = ga; break;
      case 'euglena': // spindle-shaped alga with one long front flagellum
        ctx.moveTo(r * 1.1, 0); ctx.quadraticCurveTo(0, -r * 0.7, -r * 1.1, 0); ctx.quadraticCurveTo(0, r * 0.7, r * 1.1, 0); ctx.fillStyle = '#66C27A'; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(r * 0.6, -r * 0.1, r * 0.1, 0, 6.28); ctx.fillStyle = '#D9342B'; ctx.fill();
        ctx.strokeStyle = INK; tail(r * 1.1, 1, r * 1.1, t, c.ph, 0.22, 0.3); break;
      case 'chlamy': // green alga, two front flagella doing breaststroke, red eyespot
        ctx.ellipse(0, 0, r * 0.75, r * 0.62, 0, 0, 6.28); ctx.fillStyle = '#7CC96A'; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(r * 0.2, -r * 0.3, r * 0.12, 0, 6.28); ctx.fillStyle = '#D9342B'; ctx.fill();
        var sw = Math.sin(t * 0.012 + c.ph) * 0.6;
        ctx.beginPath(); ctx.moveTo(r * 0.7, 0); ctx.quadraticCurveTo(r * 1.3, -r * (0.6 + sw), r * 0.6, -r * 1.3);
        ctx.moveTo(r * 0.7, 0); ctx.quadraticCurveTo(r * 1.3, r * (0.6 + sw), r * 0.6, r * 1.3); ctx.lineWidth = 1; ctx.stroke(); break;
    }
    ctx.restore();
  }

  // only Na draws its letters, as the glow; everything else is spelled by the cells alone
  function letters(s) {
    if (!ghost) return;
    ctx.save(); ctx.font = ghost.font; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ghost.draws.forEach(function (d) {
      var g = d[3], a = s - ACT[g]; if (a < 0) return;
      var settle = clamp((a - SETTLE[g] + 0.3) / 0.8);
      ctx.save();
      if (g === 'na') {
        // the letters themselves are the light: a yellow glow that fades once the cells have gathered
        var glow = clamp(a / 0.4) * (1 - settle), pulse = 0.75 + 0.25 * Math.sin(s * 6);
        ctx.shadowColor = 'rgba(255,200,40,' + (0.9 * glow) + ')'; ctx.shadowBlur = ghost.size * 0.35 * pulse * glow;
        ctx.fillStyle = 'rgba(255,208,70,0.55)';
        ctx.globalAlpha = clamp(a / 0.4) * (1 - settle);
        if (ctx.globalAlpha <= 0) { ctx.restore(); return; }
        ctx.fillText(d[0], d[1], d[2]);
      }
      ctx.restore();
    });
    ctx.restore();
  }
  function channels(s) {
    if (still || !lanes.length) return;
    var a = s - ACT.ka, v = clamp(a * 3) * (1 - clamp((a - SETTLE.ka) / 0.8));
    if (v <= 0) return;
    // each channel is a solid little tube: pale inside, inked walls, open mouth at the letter end
    ctx.save(); ctx.globalAlpha = v; ctx.lineWidth = 1.3; ctx.strokeStyle = INK; ctx.lineCap = 'round';
    lanes.forEach(function (l) {
      var open = clamp(a * 2.5), x0 = W - (W - l.x) * open, h = l.h;                       // channels grow in from the right
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(x0, l.y - h, W - x0, h * 2);
      ctx.beginPath(); ctx.moveTo(x0, l.y - h); ctx.lineTo(W, l.y - h); ctx.moveTo(x0, l.y + h); ctx.lineTo(W, l.y + h); ctx.stroke();
    });
    ctx.restore();
  }
  function stream(s) {
    // water flowing out of "ne" toward the right while its act plays
    var z = zones.ne; if (!z || still) return;
    var a = s - ACT.ne, v = clamp(a * 3) * (1 - clamp((a - ARRIVE - 0.2) / 0.8));
    if (v <= 0) return;
    // a band of water with wavy edges, streaks racing to the right and particles carried along
    var sz = ghost.size, top = z.y - sz * 0.48, bot = z.y + sz * 0.48, x0 = z.x0 - sz * 0.15;
    ctx.save(); ctx.globalAlpha = v;
    ctx.beginPath(); ctx.moveTo(x0, top);
    for (var wx = x0; wx <= W; wx += 12) ctx.lineTo(wx, top + Math.sin(wx * 0.04 - s * 6) * 3);
    for (var wx2 = W; wx2 >= x0; wx2 -= 12) ctx.lineTo(wx2, bot + Math.sin(wx2 * 0.04 - s * 6 + 1) * 3);
    ctx.closePath(); ctx.fillStyle = 'rgba(110,185,230,.22)'; ctx.fill();
    ctx.strokeStyle = '#3E8FB5'; ctx.lineWidth = 1.2; ctx.globalAlpha = v * 0.6; ctx.stroke();
    ctx.lineCap = 'round';
    for (var f = 0; f < 7; f++) {
      var fy = top + (bot - top) * (f + 0.5) / 7, sp = 150 + (f % 3) * 40, gap = 70 + (f % 2) * 20, off = (s * sp + f * 37) % gap;
      for (var fx = x0 + off - gap; fx < W + 30; fx += gap) {
        if (fx < x0) continue;
        ctx.globalAlpha = v * 0.75; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + 26, fy); ctx.lineTo(fx + 20, fy - 4); ctx.moveTo(fx + 26, fy); ctx.lineTo(fx + 20, fy + 4); ctx.stroke();
      }
    }
    ctx.fillStyle = '#3E8FB5';
    for (var pq = 0; pq < 40; pq++) {
      var px = x0 + ((pq * 97 + s * (120 + (pq % 5) * 30)) % (W - x0)), py = top + (bot - top) * ((pq * 0.618) % 1);
      ctx.globalAlpha = v * 0.5; ctx.beginPath(); ctx.arc(px, py, 1.6, 0, 6.28); ctx.fill();
    }
    ctx.restore();
  }

  function frame(t) {
    if (t0 === null) t0 = t;
    var s = still ? 99 : (t - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    letters(s);
    channels(s);
    stream(s);
    var naC = zones.na ? [(zones.na.x0 + zones.na.x1) / 2, zones.na.y] : [0, 0];
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (s < ACT[c.g]) continue;
      var p = clamp((s - c.delay) / ARRIVE);
      if (c.g === 'ka') {                               // straight down its channel, then stop and turn in place
        var u = clamp((s - c.delay) / 1.9), l = c.lane;
        if (u < 0.7) { c.x = c.sx + (l.x - c.sx) * (u / 0.7); c.y = l.y; c.a = Math.PI; }      // through the channel
        else if (u < 1) { var q = ease((u - 0.7) / 0.3); c.x = l.x + (c.tx - l.x) * q; c.y = l.y + (c.ty - l.y) * q; c.a = Math.atan2(c.ty - l.y, c.tx - l.x); }
        else { c.x = c.tx; c.y = c.ty; c.a = Math.PI + Math.sin(t * 0.001 + c.ph) * 0.2; }
      } else if (c.g === 'ne') {
        var qn = ease((s - c.delay) / 1.8);
        c.x = c.sx + (c.tx - c.sx) * qn + (qn < 1 ? Math.sin(t * 0.008 + c.ph) * 5 : Math.sin(t * 0.004 + c.ph));   // pushed back a little by the flow
        c.y = c.ty; c.a = Math.PI + Math.sin(t * 0.002 + c.ph) * 0.15;
      } else if (p < 1) {
        var k = 0.025 + p * 0.1;
        if (c.g === 'na') k *= (Math.sin(t * 0.02 + c.ph) > 0.2 ? 2.2 : 0.15);       // twitching: pull, pause, pull
        c.x += (c.tx - c.x) * k; c.y += (c.ty - c.y) * k; c.a = Math.atan2(c.ty - c.y, c.tx - c.x);
        if (c.g === 'lab') c.a += Math.sin(t * 0.01 + c.ph) * 0.6;                     // run-and-tumble wobble
      } else {
        c.x = c.tx; c.y = c.ty;
        if (c.g === 'na') { c.x += Math.sin(t * 0.03 + c.ph) > 0.92 ? 1.2 : 0; c.a = Math.atan2(naC[1] - c.ty, naC[0] - c.tx); }  // pili point at the light
        else { c.x += Math.sin(t * 0.002 + c.ph) * 0.8; c.y += Math.cos(t * 0.0017 + c.ph) * 0.8; c.a += Math.sin(t * 0.001 + c.ph) * 0.004; }
      }
      shape(c, t);
    }
    if (legend.length && !still) legend.forEach(function (li) { var g = li.dataset.g; li.classList.toggle('on', s > END || (s >= ACT[g] && s < NEXT[g])); });
    if (!still) raf = requestAnimationFrame(frame);
  }
  function start() {
    if (!cv.clientWidth || !cv.clientHeight) return false;      // not laid out yet (hidden frame, etc.)
    cancelAnimationFrame(raf); started = true;
    build();
    if (legend.length) document.querySelector('.legend').classList.toggle('seq', !still);
    if (still) frame(0);
    else raf = requestAnimationFrame(frame);
    return true;
  }
  // Play when the logo is actually on screen, once fonts are in (or after 1.5 s at most)
  var fontsIn = new Promise(function (res) { (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(res); setTimeout(res, 1500); });
  fontsIn.then(function () {
    if ('IntersectionObserver' in window) {
      var io2 = new IntersectionObserver(function (es) { if (es[0].isIntersecting && !started) { if (start()) io2.disconnect(); } });
      io2.observe(cv);
    } else start();
    if ('ResizeObserver' in window) new ResizeObserver(function () { if (started && Math.abs(cv.clientWidth - W) > 2) start(); else if (!started) start(); }).observe(cv);
  });
  // Replay button: always animates, even when the device asks for reduced motion (the viewer asked for it)
  var replay = document.getElementById('replay');
  if (replay) replay.addEventListener('click', function () { still = false; start(); });

  // Background swimmers: microbes keep moving behind every section, and each section has its own cast.
  // Each section draws on its own canvas, so this works inside frames that size themselves to the page.
  var SCENES = {
    about: ['cyano', 'cyanorod'],
    research: ['drill', 'drill', 'spiro'],
    members: ['glider', 'peri', 'mono', 'campy', 'labpili', 'coccus'],
    movies: ['myco', 'myco', 'pili'],
    news: ['chlamy', 'euglena', 'diatom'],
    join: ['parame', 'parame', 'spiro', 'peri']
  };
  var main = ctx, pools = [];
  Object.keys(SCENES).forEach(function (id) {
    var sec = document.getElementById(id);
    if (!sec) return;
    var c = document.createElement('canvas'); c.className = 'swim'; c.setAttribute('aria-hidden', 'true');
    sec.insertBefore(c, sec.firstChild);
    var pool = { sec: sec, cv: c, g: c.getContext('2d'), kinds: SCENES[id], list: [], w: 0, h: 0, on: true };
    pools.push(pool);
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { pool.on = es[0].isIntersecting; }, { rootMargin: '200px' }).observe(sec);
  });
  function spawn(p, m, inside) {
    var side = Math.random() < 0.5 ? -1 : 1;
    m.kind = pick(p.kinds); m.col = pick(POP); m.r = rnd(11, 17); m.ph = rnd(0, 10); m.al = 0;
    m.x = inside ? rnd(0, p.w) : side < 0 ? -40 : p.w + 40; m.y = rnd(p.h * 0.05, p.h * 0.95);
    m.a = (side < 0 ? 0 : Math.PI) + (m.kind === 'drill' ? 0 : rnd(-0.5, 0.5));       // drills run dead straight
    m.v = m.kind === 'drill' ? rnd(0.9, 1.4) : m.kind === 'parame' ? rnd(0.7, 1.1) : rnd(0.4, 0.8);
  }
  function sizePool(p) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), w = p.sec.clientWidth, h = p.sec.clientHeight;
    if (!w || !h || (w === p.w && h === p.h)) return;
    p.w = w; p.h = h; p.cv.width = w * dpr; p.cv.height = h * dpr; p.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.round(Math.min(22, Math.max(6, w * h / 45000)));
    while (p.list.length < n) { var m = {}; spawn(p, m, true); p.list.push(m); }
    p.list.length = n;
  }
  function swim(t) {
    pools.forEach(function (p) {
      sizePool(p);
      if (!p.on || !p.w) return;
      p.g.clearRect(0, 0, p.w, p.h);
      p.list.forEach(function (m) {
        m.al = Math.min(1, m.al + 0.04);
        var sp = reduce ? m.v * 0.5 : m.v;                // slower, but still alive, when motion is reduced
        if (m.kind === 'cyano' || m.kind === 'cyanorod') sp *= Math.sin(t * 0.004 + m.ph) > 0.3 ? 2 : 0.1;      // twitch
        else if (m.kind !== 'drill' && Math.sin(t * 0.0009 + m.ph * 3) > 0.97) m.a += rnd(-0.6, 0.6);       // tumble now and then
        else if (m.kind !== 'drill') m.a += Math.sin(t * 0.001 + m.ph) * 0.004;
        m.x += Math.cos(m.a) * sp; m.y += Math.sin(m.a) * sp;
        if (m.x < -60 || m.x > p.w + 60 || m.y < -60 || m.y > p.h + 60) { spawn(p, m, false); return; }
        ctx = p.g; ctx.globalAlpha = 0.55 * m.al; shape(m, t); ctx.globalAlpha = 1; ctx = main;
      });
    });
    requestAnimationFrame(swim);
  }
  requestAnimationFrame(swim);
})();
