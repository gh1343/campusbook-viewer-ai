(() => {
  try {
    if (typeof window === "undefined" || typeof localStorage === "undefined")
      return;

    // 1) scroll/DOM 관찰로 "실제로 페이지 점프가 발생했는지" 추적
    const log_scroll = (tag) => {
      try {
        const se = document.scrollingElement;
        console.log(`[progress_debug] scroll ${tag}`, {
          scrollTop: se ? se.scrollTop : null,
          scrollHeight: se ? se.scrollHeight : null,
          clientHeight: se ? se.clientHeight : null,
        });
      } catch (e) {
        console.log("[progress_debug] scroll log failed", e);
      }
    };

    // 2) RMS 호출이 실제로 발생하는지 fetch를 후킹해서 추적
    const orig_fetch = window.fetch ? window.fetch.bind(window) : null;
    if (orig_fetch && !window.__progress_debug_fetch_hooked__) {
      window.__progress_debug_fetch_hooked__ = true;
      window.fetch = async (...args) => {
        const url = args && args[0] ? String(args[0]) : "";
        const opts = args && args[1] ? args[1] : null;
        const is_rms =
          url.includes("/v3/rms/rmsData") || url.includes("/v2/rms/rmsData");

        if (is_rms) {
          console.log("[progress_debug] fetch ->", url, {
            method: opts && opts.method ? opts.method : "GET",
            hasBody: !!(opts && opts.body),
          });
          if (opts && typeof opts.body === "string") {
            try {
              console.log("[progress_debug] fetch body", JSON.parse(opts.body));
            } catch {
              console.log("[progress_debug] fetch body(raw)", opts.body);
            }
          }
        }

        const res = await orig_fetch(...args);
        if (is_rms) {
          try {
            const cloned = res.clone();
            const text = await cloned.text();
            console.log("[progress_debug] fetch <-", url, { status: res.status });
            try {
              console.log(
                "[progress_debug] fetch response(json)",
                JSON.parse(text)
              );
            } catch {
              console.log(
                "[progress_debug] fetch response(text)",
                text.slice(0, 500)
              );
            }
          } catch (e) {
            console.log("[progress_debug] fetch response read failed", e);
          }
        }
        return res;
      };
    }

    // 3) progress 저장이 실제로 업데이트 되는지 localStorage.setItem 후킹
    const orig_set_item = localStorage.setItem
      ? localStorage.setItem.bind(localStorage)
      : null;
    if (orig_set_item && !window.__progress_debug_setitem_hooked__) {
      window.__progress_debug_setitem_hooked__ = true;
      localStorage.setItem = (k, v) => {
        try {
          if (typeof k === "string" && k.startsWith("progress_")) {
            let last = null;
            try {
              const arr = JSON.parse(String(v));
              if (Array.isArray(arr) && arr.length) last = arr[arr.length - 1];
            } catch {
              // ignore
            }
            console.log(
              "[progress_debug] localStorage.setItem(progress)",
              k,
              "last=",
              last
            );
          }
        } catch {
          // ignore
        }
        return orig_set_item(k, v);
      };
    }

    const params = new URLSearchParams(window.location.search);
    const bookCd = (params.get("bookCd") || "").trim();
    const memberCd = (params.get("memberCd") || "").trim();
    const pageOffset = Number(params.get("rmsPageOffset") || "0") || 0;

    console.log("[progress_debug] query", { bookCd, memberCd, rmsPageOffset: pageOffset });

    const progress_prefix = "progress_";
    const keys = Object.keys(localStorage).filter(
      (k) => k && k.startsWith(progress_prefix)
    );
    let key = null;

    if (bookCd && memberCd) {
      const expectedSuffix = `${memberCd}_${bookCd}`;
      key = keys.find((k) => k === `${progress_prefix}${expectedSuffix}`) || null;
    }

    if (!key && bookCd) key = keys.find((k) => k.includes(bookCd)) || null;
    if (!key) key = keys[0] || null;

    console.log("[progress_debug] progress_keys", keys);
    console.log("[progress_debug] selected_key", key);

    if (!key) return;

    const raw = localStorage.getItem(key);
    let arr = null;
    try {
      arr = JSON.parse(raw || "null");
    } catch {
      arr = null;
    }

    const last = Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
    const idx = Number(last && last.idx);
    const level = Number(last && last.level);
    const picked = Number.isFinite(idx) ? idx : Number.isFinite(level) ? level : NaN;
    const computedPage = Number.isFinite(picked)
      ? Math.max(1, Math.round(picked - pageOffset))
      : null;

    console.log("[progress_debug] raw_last", last);
    console.log("[progress_debug] picked", {
      idx,
      level,
      picked,
      pageOffset,
      computedPage,
    });

    // 4) 강제 스크롤(페이지 DOM이 늦게 생성되는 케이스 대응)
    const try_scroll_to_page = (page) => {
      if (!Number.isFinite(page) || page <= 0) return false;
      const el =
        document.getElementById(`page-${page}`) ||
        document.querySelector(`#page-${page}`) ||
        document.querySelector(`.pdf-page[id='page-${page}']`);
      if (!el) return false;

      el.scrollIntoView({ block: "start", behavior: "auto" });

      // scrollIntoView가 body가 아니라 내부 스크롤 컨테이너에서 동작하는 케이스 보정
      const find_scroll_parent = (node) => {
        let cur = node && node.parentElement ? node.parentElement : null;
        while (cur) {
          const style = window.getComputedStyle(cur);
          const y = style.overflowY;
          if ((y === "auto" || y === "scroll") && cur.scrollHeight > cur.clientHeight)
            return cur;
          cur = cur.parentElement;
        }
        return document.scrollingElement || document.documentElement;
      };
      const sp = find_scroll_parent(el);
      try {
        const top = el.getBoundingClientRect().top + (sp.scrollTop || 0) - 20;
        sp.scrollTop = top;
      } catch {
        // ignore
      }

      console.log("[progress_debug] forced scroll", {
        page,
        scroll_parent: sp && sp.tagName ? sp.tagName : null,
      });
      return true;
    };

    const try_pdfjs_navigate = (page) => {
      try {
        const app = window.PDFViewerApplication;
        if (app && app.pdfViewer && Number.isFinite(page) && page > 0) {
          app.pdfViewer.currentPageNumber = page;
          console.log("[progress_debug] pdfjs currentPageNumber set", { page });
          return true;
        }
      } catch {
        // ignore
      }
      return false;
    };

    // pdf.js는 문서/페이지 준비 전에는 currentPageNumber 세팅이 무시될 수 있어서,
    // eventBus(pagesinit/pagesloaded) 이후에 이동하도록 훅을 건다.
    const hook_pdfjs_events = (page) => {
      if (!Number.isFinite(page) || page <= 0) return false;
      try {
        const app = window.PDFViewerApplication;
        if (!app || !app.eventBus) return false;
        if (window.__progress_debug_pdfjs_hooked__) return true;
        window.__progress_debug_pdfjs_hooked__ = true;

        const go = () => {
          try_pdfjs_navigate(page);
        };

        app.eventBus.on("pagesinit", () => {
          console.log("[progress_debug] pdfjs event: pagesinit");
          go();
        });
        app.eventBus.on("pagesloaded", (e) => {
          console.log("[progress_debug] pdfjs event: pagesloaded", e);
          go();
        });
        app.eventBus.on("pagerendered", (e) => {
          // 최초 렌더 이후 한 번 더 시도(초기 스크롤 안정화)
          if (e && e.pageNumber === 1) {
            console.log("[progress_debug] pdfjs event: pagerendered(first)");
            go();
          }
        });

        console.log("[progress_debug] pdfjs event hook attached");
        return true;
      } catch (e) {
        console.log("[progress_debug] pdfjs hook failed", e);
        return false;
      }
    };

    if (computedPage) {
      hook_pdfjs_events(computedPage);
      let attempts = 0;
      const max_attempts = 60; // ~15초 (250ms * 60)
      const timer_scroll = setInterval(() => {
        attempts++;
        const ok = try_scroll_to_page(computedPage) || try_pdfjs_navigate(computedPage);
        if (ok || attempts >= max_attempts) {
          if (!ok)
            console.log("[progress_debug] forced scroll failed", {
              computedPage,
              attempts,
            });
          clearInterval(timer_scroll);
        }
      }, 250);
    }

    // 5) 페이지 DOM 생성 여부를 MutationObserver로 추적
    if (!window.__progress_debug_mutation_hooked__) {
      window.__progress_debug_mutation_hooked__ = true;
      const mo = new MutationObserver(() => {
        const pages = document.querySelectorAll(".pdf-page[id^='page-']");
        if (pages.length > 0) {
          const first = pages[0] && pages[0].id ? pages[0].id : null;
          const lastId =
            pages[pages.length - 1] && pages[pages.length - 1].id
              ? pages[pages.length - 1].id
              : null;
          console.log("[progress_debug] mutation: pdf pages detected", {
            count: pages.length,
            first,
            last: lastId,
          });
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }

    // 4) 초반 2초 동안 점프 여부(스크롤 변화/렌더 상태)를 주기적으로 찍기
    log_scroll("init");
    let tick = 0;
    const timer = setInterval(() => {
      tick++;
      const pdf_pages = document.querySelectorAll(".pdf-page").length;
      if (tick === 1) {
        console.log("[progress_debug] readyState", document.readyState, "href", location.href);
      }
      if (pdf_pages > 0) {
        const ids = Array.from(document.querySelectorAll(".pdf-page[id]"))
          .slice(0, 5)
          .map((n) => n.id);
        console.log("[progress_debug] tick", tick, { pdf_pages, sample_ids: ids });
      } else {
        console.log("[progress_debug] tick", tick, { pdf_pages });
      }
      log_scroll(`t${tick}`);
      if (tick >= 8) clearInterval(timer);
    }, 250);
  } catch (e) {
    console.log("[progress_debug] failed", e);
  }
})();
