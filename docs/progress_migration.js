(() => {
  try {
    if (typeof window === "undefined" || typeof localStorage === "undefined")
      return;

    const progress_prefix = "progress_";
    let migrated_count = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(progress_prefix)) continue;

      const raw = localStorage.getItem(key);
      if (!raw) continue;

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!Array.isArray(data) || data.length === 0) continue;

      let changed = false;
      const migrated = data.map((item) => {
        if (!item || typeof item !== "object") return item;

        const next = { ...item };

        if (typeof next.idx === "string" && next.idx.trim() !== "") {
          const n = Number(next.idx);
          if (Number.isFinite(n)) {
            next.idx = n;
            changed = true;
          }
        }

        if (typeof next.level === "string" && next.level.trim() !== "") {
          const n = Number(next.level);
          if (Number.isFinite(n)) {
            next.level = n;
            changed = true;
          }
        }

        if (
          typeof next.timestamp === "string" &&
          next.timestamp.trim() !== ""
        ) {
          const n = Number(next.timestamp);
          if (Number.isFinite(n)) {
            next.timestamp = n;
            changed = true;
          }
        }

        return next;
      });

      if (changed) {
        localStorage.setItem(key, JSON.stringify(migrated));
        migrated_count++;
        console.log(
          "[progress_migration] migrated:",
          key,
          "last=",
          migrated[migrated.length - 1]
        );
      } else {
        console.log("[progress_migration] no change:", key);
      }
    }

    console.log("[progress_migration] done. migrated_count=", migrated_count);
  } catch {
    // noop
  }
})();
