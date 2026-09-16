/* ==========================================================================
   NieBlong · 自定义脚本
   1) 注入底部波浪的 4 个图层
   2) 首屏以下的文章卡片滚动进场
   注入方式：主题配置 custom_js: /js/custom.js
   ========================================================================== */
(function () {
  'use strict';

  var reduceMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------
     1. 底部波浪
     波浪本身由 CSS 绘制（mask + 位移），这里只负责挂载 DOM
     ------------------------------------------------------------------ */
  function buildOcean() {
    if (document.querySelector('.ocean')) {
      return;
    }

    var ocean = document.createElement('div');
    ocean.className = 'ocean';
    ocean.setAttribute('aria-hidden', 'true');

    for (var i = 1; i <= 4; i++) {
      var layer = document.createElement('i');
      layer.className = 'ocean-layer ocean-' + i;
      ocean.appendChild(layer);
    }

    document.body.appendChild(ocean);
  }

  /* ------------------------------------------------------------------
     2. 滚动进场
     只处理初始视口以下的卡片，避免首屏元素闪一下
     ------------------------------------------------------------------ */
  function setupReveal() {
    if (reduceMotion || !('IntersectionObserver' in window)) {
      return;
    }

    var cards = document.querySelectorAll('.index-card');
    if (!cards.length) {
      return;
    }

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) {
            return;
          }

          var el = entry.target;
          var delay = parseInt(el.getAttribute('data-reveal-delay') || '0', 10);

          window.setTimeout(function () {
            el.classList.add('is-visible');
          }, delay);

          io.unobserve(el);
        });
      },
      {
        rootMargin: '0px 0px -8% 0px',
        threshold: 0.05
      }
    );

    Array.prototype.forEach.call(cards, function (el, index) {
      var rect = el.getBoundingClientRect();

      // 已经在首屏内的不动，直接保持可见
      if (rect.top < window.innerHeight * 0.92) {
        return;
      }

      el.classList.add('reveal');
      el.setAttribute('data-reveal-delay', String((index % 3) * 90));
      io.observe(el);
    });
  }

  function init() {
    buildOcean();
    setupReveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
