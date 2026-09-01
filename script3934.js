
(() => {
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => [...r.querySelectorAll(s)];
  const pad = n => String(n).padStart(2, '0');

  // Marketing mobile navigation.
  const menu = q('.menu');
  const marketingLinks = q('.nav-links');
  if (menu && marketingLinks) {
    menu.addEventListener('click', () => {
      const open = marketingLinks.classList.toggle('open');
      menu.setAttribute('aria-expanded', String(open));
    });
    marketingLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        marketingLinks.classList.remove('open');
        menu.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // NYSE calendar provisioned through 2028. Beyond this date we fail closed to UNKNOWN.
  const CALENDAR_HORIZON = '2028-12-31';

  const holidays = new Set([
    // 2026
    '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25',
    '2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
    // 2027
    '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31',
    '2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24',
    // 2028
    '2028-01-17','2028-02-21','2028-04-14','2028-05-29','2028-06-19',
    '2028-07-04','2028-09-04','2028-11-23','2028-12-25'
  ]);

  const halfDays = new Set([
    '2026-11-27',
    '2026-12-24',
    '2027-11-26',
    '2027-12-23',
    '2028-07-03',
    '2028-11-24'
  ]);

  function ny(d = new Date()) {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
    return { y:+p.year, m:+p.month, d:+p.day, w:p.weekday, h:+p.hour, min:+p.minute, s:+p.second };
  }

  function key(p) { return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }
  function weekend(p) { return p.w === 'Sat' || p.w === 'Sun'; }
  function holiday(p) { return holidays.has(key(p)); }
  function halfDay(p) { return halfDays.has(key(p)); }
  function provisioned(p) { return key(p) <= CALENDAR_HORIZON; }

  function state(p) {
    if (!provisioned(p)) return 'UNKNOWN';
    if (weekend(p)) return 'CLOSED — WEEKEND';
    if (holiday(p)) return 'CLOSED — HOLIDAY';

    const minutes = p.h * 60 + p.min;
    const regularClose = halfDay(p) ? 780 : 960;   // 13:00 or 16:00 ET
    const extendedClose = halfDay(p) ? 1020 : 1200; // 17:00 or 20:00 ET

    if (minutes >= 570 && minutes < regularClose) return 'REGULAR';
    if ((minutes >= 240 && minutes < 570) || (minutes >= regularClose && minutes < extendedClose)) return 'EXTENDED';

    // A closure is reported as a weekend whenever the next regular open is more than a day
    // away, which matches MarketCalendar.sessionAt in the protocol. Labelling Friday night
    // as an overnight gap would understate a sixty hour closure. scanForOpen contains no
    // call back into state, so the two never recurse.
    const from = wall(p.y, p.m, p.d, p.h, p.min, p.s || 0);
    const next = scanForOpen(p, from);
    if (!next) return 'UNKNOWN';
    return (next - from) > 86400000 ? 'CLOSED — WEEKEND' : 'CLOSED — OVERNIGHT';
  }

  // True when the Eastern Time parts fall inside a regular session. Does not call state.
  function inRegularSession(p) {
    if (!provisioned(p) || weekend(p) || holiday(p)) return false;
    const minutes = p.h * 60 + p.min;
    return minutes >= 570 && minutes < (halfDay(p) ? 780 : 960);
  }

  // Finds the next regular open strictly after `from`. Contains no call to state.
  function scanForOpen(p, from) {
    if (!provisioned(p)) return undefined;

    if (!weekend(p) && !holiday(p) && (p.h * 60 + p.min) < 570) {
      return wall(p.y, p.m, p.d, 9, 30);
    }

    for (let i = 1; i <= 10; i++) {
      const x = addCalendarDay(p, i);
      const probe = ny(wall(x.y, x.m, x.d, 12, 0));
      if (!provisioned(probe)) return undefined;
      if (!weekend(probe) && !holiday(probe)) {
        const open = wall(x.y, x.m, x.d, 9, 30);
        if (open > from) return open;
      }
    }
    return undefined;
  }

  function wall(y, m, d, h, min, s = 0) {
    let guess = new Date(Date.UTC(y, m - 1, d, h, min, s));
    for (let i = 0; i < 3; i++) {
      const p = ny(guess);
      const wanted = Date.UTC(y, m - 1, d, h, min, s);
      const got = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
      guess = new Date(guess.getTime() + wanted - got);
    }
    return guess;
  }

  function addCalendarDay(p, delta) {
    const t = new Date(Date.UTC(p.y, p.m - 1, p.d) + delta * 86400000);
    return { y:t.getUTCFullYear(), m:t.getUTCMonth()+1, d:t.getUTCDate() };
  }

  function nextOpen(now = new Date()) {
    const p = ny(now);
    if (!provisioned(p)) return undefined;
    if (inRegularSession(p)) return now;
    return scanForOpen(p, now);
  }

  function formatCountdown(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function capacityTarget(st, next, now) {
    if (st === 'REGULAR') return 100;
    if (st === 'UNKNOWN' || !next) return 70;
    const hours = Math.max(0, (next - now) / 3600000);
    if (hours <= 6) return 95;
    if (hours <= 24) return 90;
    if (hours <= 48) return 85;
    return 75;
  }

  function nextOpenLabel(next) {
    if (!next) return 'an unresolved market open';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(next).reduce((a, x) => (a[x.type] = x.value, a), {});
    return `${parts.weekday} ${parts.hour}:${parts.minute} ET`;
  }

  function updateBorrowExplanation(st, next, cap) {
    const box = q('[data-borrow-explanation]');
    if (!box) return;

    if (st === 'REGULAR') {
      box.textContent = 'The regular market is open. The indicative design target is 100% of open-session capacity. Live protocol parameters do not exist yet.';
      return;
    }
    if (st === 'UNKNOWN') {
      box.textContent = 'The market calendar is outside the site’s provisioned horizon, so Pond treats the session as UNKNOWN and uses a conservative 70% indicative capacity target.';
      return;
    }
    box.textContent = `The market is ${st.toLowerCase()} until ${nextOpenLabel(next)}, so the indicative design target is ${cap}% of open-session capacity. Live protocol parameters do not exist yet.`;
  }

  function tick() {
    const now = new Date();
    const p = ny(now);
    const st = state(p);
    const next = nextOpen(now);
    const cap = capacityTarget(st, next, now);

    qa('[data-clock]').forEach(c => {
      c.classList.toggle('closed', !['REGULAR', 'EXTENDED'].includes(st));
      const stateEl = q('[data-state]', c);
      const countEl = q('[data-count]', c);
      const capEl = q('[data-cap]', c);
      if (stateEl) stateEl.textContent = st;
      if (countEl) countEl.textContent = st === 'REGULAR' ? 'OPEN' : (next ? formatCountdown(next - now) : 'UNKNOWN');
      if (capEl) capEl.textContent = `${cap}%`;
    });

    updateBorrowExplanation(st, next, cap);
  }

  tick();
  setInterval(tick, 1000);

  // App tabs: complete ARIA relationships + keyboard behavior.
  const tabs = qa('.tab[role="tab"]');
  const views = qa('.view[role="tabpanel"]');
  const tablist = q('.tabs[role="tablist"]');

  // The strip lays itself out from the number of tabs actually present, so adding one to
  // the markup needs no stylesheet change. Previously the column count and the sliding
  // indicator each hardcoded four, and a fifth tab wrapped onto a second row while the
  // indicator still sized to a quarter.
  if (tablist && tabs.length) {
    tablist.style.setProperty('--tab-count', String(tabs.length));
  }

  function activateTab(tab, focus = true) {
    if (!tab) return;
    const id = tab.dataset.v;
    const index = tabs.indexOf(tab);
    tabs.forEach(t => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
    });
    views.forEach(v => {
      const active = v.id === `v-${id}`;
      v.hidden = !active;
      v.classList.remove('view-enter');
      if (active && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
        requestAnimationFrame(() => v.classList.add('view-enter'));
      }
    });
    if (tablist) tablist.style.setProperty('--tab-index', String(index));
    if (focus) tab.focus({ preventScroll: true });
  }

  tabs.forEach(tab => tab.addEventListener('click', () => activateTab(tab, false)));

  if (tablist) {
    tablist.addEventListener('keydown', e => {
      const current = tabs.indexOf(document.activeElement);
      if (current < 0) return;
      let nextIndex = null;
      if (e.key === 'ArrowRight') nextIndex = (current + 1) % tabs.length;
      if (e.key === 'ArrowLeft') nextIndex = (current - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home') nextIndex = 0;
      if (e.key === 'End') nextIndex = tabs.length - 1;
      if (nextIndex !== null) {
        e.preventDefault();
        activateTab(tabs[nextIndex]);
      }
    });
  }

  document.addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    const map = { '1':'supply', '2':'borrow', '3':'positions', '4':'markets' };
    if (map[e.key]) {
      const tab = tabs.find(t => t.dataset.v === map[e.key]);
      activateTab(tab);
    }
  });

  // Prototype actions remain honest. Borrow adds the specific session explanation.
  qa('[data-action]').forEach(button => {
    button.addEventListener('click', () => {
      const message = q('#msg');
      if (!message) return;
      if (button.dataset.action === 'borrow') {
        const p = ny(new Date());
        const st = state(p);
        const next = nextOpen(new Date());
        const cap = capacityTarget(st, next, new Date());
        message.textContent = st === 'REGULAR'
          ? 'Borrowing is not live yet. The market is currently in its regular session, so the indicative design target is 100% of open-session capacity.'
          : st === 'UNKNOWN'
            ? 'Borrowing is not live yet. The calendar is outside the provisioned horizon, so the interface treats the session as UNKNOWN and uses a 70% indicative capacity target.'
            : `Borrowing is not live yet. The market is ${st.toLowerCase()} until ${nextOpenLabel(next)}, so the indicative design target is ${cap}% of open-session capacity.`;
      } else {
        message.textContent = 'Pond is still building. No contract action is available yet.';
      }
      message.hidden = false;
    });
  });

  // Expose pure calendar helpers for local QA without making any network request.
  window.PondMarketCalendar = window.AcreMarketCalendar = { ny, state, nextOpen, capacityTarget, holidays, halfDays, CALENDAR_HORIZON };

  // Authored scroll choreography. Motion is opt-in only when the user has not requested reduction.
  const motionAllowed = window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
  if (motionAllowed) {
    document.body.classList.add('motion-ready');

    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14 });
    qa('.reveal-section').forEach(section => revealObserver.observe(section));

    const timeline = q('[data-timeline]');
    if (timeline) {
      const timelineObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            timeline.classList.add('timeline-visible');
            timelineObserver.disconnect();
          }
        });
      }, { threshold: 0.28 });
      timelineObserver.observe(timeline);
    }

    const riskRows = qa('.risk-row');
    if (riskRows.length) {
      const riskObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const idx = riskRows.indexOf(entry.target);
            window.setTimeout(() => entry.target.classList.add('is-visible'), idx * 80);
            riskObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.26 });
      riskRows.forEach(row => riskObserver.observe(row));
    }
  } else {
    qa('.reveal-section').forEach(section => section.classList.add('is-visible'));
    qa('.risk-row').forEach(row => row.classList.add('is-visible'));
    const timeline = q('[data-timeline]');
    if (timeline) timeline.classList.add('timeline-visible');
  }

  // Dock the signature market clock into the header when scrolling down past the hero.
  const hero = q('.immersive-hero');
  const headerClock = q('.header-clock');
  if (headerClock) {
    const marketClock = q('#market-clock') || hero;
    const onScroll = () => {
      const rect = (marketClock || hero)?.getBoundingClientRect();
      const shouldDock = rect ? (rect.bottom < 80 || window.scrollY > 240) : (window.scrollY > 200);
      document.body.classList.toggle('clock-docked', shouldDock);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }


  // Documentation table of contents: highlight the section currently in view.
  // Uses IntersectionObserver rather than a scroll handler so it costs nothing
  // while the page is idle. Runs regardless of motion preference, because this is
  // navigation state rather than decoration.
  const tocLinks = qa('.docs-toc-inner a');
  if (tocLinks.length) {
    const byId = new Map();
    tocLinks.forEach(link => {
      const id = link.getAttribute('href');
      if (id && id.startsWith('#')) byId.set(id.slice(1), link);
    });

    const visible = new Set();

    const markCurrent = () => {
      tocLinks.forEach(link => link.classList.remove('is-current'));
      // Choose the topmost visible section so the highlight does not jump around
      // when several sections are on screen at once.
      let best = null;
      let bestTop = Infinity;
      visible.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const top = el.getBoundingClientRect().top;
        if (top < bestTop) { bestTop = top; best = id; }
      });
      if (best && byId.has(best)) byId.get(best).classList.add('is-current');
    };

    const tocObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      });
      markCurrent();
    }, { rootMargin: '-100px 0px -60% 0px' });

    byId.forEach((_, id) => {
      const section = document.getElementById(id);
      if (section) tocObserver.observe(section);
    });
  }

})();

if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
  const hero = document.querySelector('.immersive-hero');
  const img = document.querySelector('.arch-image');
  if (hero && img) {
    hero.addEventListener('pointermove', e => {
      const x = (e.clientX / innerWidth - .5) * 10;
      const y = (e.clientY / innerHeight - .5) * 6;
      img.style.transform = `scale(1.05) translate(${x}px,${y}px)`;
    });
    hero.addEventListener('pointerleave', () => img.style.transform = 'scale(1.04)');
  }
}

// Liquid metal button interactive click ripple animation
document.addEventListener('click', e => {
  const btn = e.target.closest('.solid-pill, .glass-pill, .nav-launch, .btn, .term, .app-button');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const ripple = document.createElement('span');
  ripple.className = 'liquid-ripple';
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);
});

// Shifting specular corner highlight tracking on mouse move
document.addEventListener('pointermove', e => {
  const btn = e.target.closest('.solid-pill, .glass-pill, .nav-launch, .btn, .term, .app-button');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const xPercent = Math.max(15, Math.min(85, ((e.clientX - rect.left) / rect.width) * 100));
  const yPercent = Math.max(0, Math.min(30, ((e.clientY - rect.top) / rect.height) * 100));
  btn.style.setProperty('--mx', `${xPercent}%`);
  btn.style.setProperty('--my', `${yPercent}%`);
});

document.addEventListener('pointerleave', e => {
  const btn = e.target.closest('.solid-pill, .glass-pill, .nav-launch, .btn, .term, .app-button');
  if (!btn) return;
  btn.style.removeProperty('--mx');
  btn.style.removeProperty('--my');
}, true);

// Interactive Random Letter Swap hover effect for navigation links
const scrambleChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
document.querySelectorAll('.nav-links a:not(.mobile-x-link)').forEach(link => {
  const originalText = link.textContent.trim();
  let interval = null;
  link.addEventListener('mouseenter', () => {
    let iteration = 0;
    clearInterval(interval);
    interval = setInterval(() => {
      link.innerText = originalText
        .split('')
        .map((letter, index) => {
          if (index < iteration) return originalText[index];
          if (letter === ' ') return ' ';
          return scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
        })
        .join('');

      if (iteration >= originalText.length) {
        clearInterval(interval);
      }
      iteration += 1 / 3;
    }, 25);
  });
  link.addEventListener('mouseleave', () => {
    clearInterval(interval);
    link.innerText = originalText;
  });
});

// Progressive 1-by-1 Scroll Reveal & Typewriter Animation for Architecture Section
const archSection = document.querySelector('.architecture-section');
const archSteps = [
  document.querySelector('.arch-step.step-a'),
  document.querySelector('.arch-step.step-b'),
  document.querySelector('.arch-step.step-c')
].filter(Boolean);

if (archSection && archSteps.length === 3) {
  // Store original texts for each step
  const stepData = archSteps.map(step => {
    const span = step.querySelector('span');
    const h3 = step.querySelector('h3');
    const p = step.querySelector('p');
    return {
      step,
      span,
      h3,
      p,
      spanText: span ? span.textContent.trim() : '',
      h3Text: h3 ? h3.textContent.trim() : '',
      pText: p ? p.textContent.trim() : '',
      isTyped: false,
      timers: []
    };
  });

  const clearTimers = (item) => {
    item.timers.forEach(t => clearTimeout(t));
    item.timers = [];
    const oldCursor = item.step.querySelector('.typing-cursor');
    if (oldCursor) oldCursor.remove();
  };

  const typeText = (item) => {
    if (item.isTyped) return;
    item.isTyped = true;
    clearTimers(item);

    // Initial clear
    if (item.span) item.span.textContent = '';
    if (item.h3) item.h3.textContent = '';
    if (item.p) item.p.textContent = '';

    const cursor = document.createElement('span');
    cursor.className = 'typing-cursor';

    // Step 1: Wait 180ms after border appears, then type span (number)
    const t0 = setTimeout(() => {
      if (item.span) {
        item.span.textContent = item.spanText;
      }

      // Step 2: Type h3 title
      if (item.h3) {
        item.h3.appendChild(cursor);
        let hIndex = 0;
        const typeH3 = () => {
          if (hIndex < item.h3Text.length) {
            item.h3.textContent = item.h3Text.slice(0, hIndex + 1);
            item.h3.appendChild(cursor);
            hIndex++;
            const tH = setTimeout(typeH3, 22);
            item.timers.push(tH);
          } else {
            // Step 3: Type paragraph description
            if (item.p) {
              item.p.appendChild(cursor);
              let pIndex = 0;
              const typeP = () => {
                if (pIndex < item.pText.length) {
                  item.p.textContent = item.pText.slice(0, pIndex + 1);
                  item.p.appendChild(cursor);
                  pIndex++;
                  const tP = setTimeout(typeP, 12);
                  item.timers.push(tP);
                } else {
                  // Done typing, fade out cursor
                  const tEnd = setTimeout(() => {
                    if (cursor.parentNode) cursor.remove();
                  }, 500);
                  item.timers.push(tEnd);
                }
              };
              const tPStart = setTimeout(typeP, 60);
              item.timers.push(tPStart);
            } else {
              cursor.remove();
            }
          }
        };
        typeH3();
      }
    }, 180);

    item.timers.push(t0);
  };

  const resetStep = (item) => {
    if (!item.isTyped) return;
    item.isTyped = false;
    clearTimers(item);
    if (item.span) item.span.textContent = item.spanText;
    if (item.h3) item.h3.textContent = item.h3Text;
    if (item.p) item.p.textContent = item.pText;
  };

  const onScrollArch = () => {
    const rect = archSection.getBoundingClientRect();
    const totalDist = archSection.offsetHeight - window.innerHeight;
    if (totalDist <= 0) return;
    
    // progress: 0 when top enters viewport, 1 when bottom reached
    const progress = Math.max(0, Math.min(1, -rect.top / totalDist));
    
    // Thresholds: Card 1 at >= 4%, Card 2 at >= 36%, Card 3 at >= 68%
    const thresholds = [0.04, 0.36, 0.68];

    stepData.forEach((item, index) => {
      const shouldShow = progress >= thresholds[index];
      if (shouldShow) {
        if (!item.step.classList.contains('is-visible')) {
          item.step.classList.add('is-visible');
          typeText(item);
        }
      } else {
        if (item.step.classList.contains('is-visible')) {
          item.step.classList.remove('is-visible');
          resetStep(item);
        }
      }
    });
  };

  window.addEventListener('scroll', onScrollArch, { passive: true });
  window.addEventListener('resize', onScrollArch, { passive: true });
  onScrollArch();
}
