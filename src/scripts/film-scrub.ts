/** Scroll-driven seek for a short-GOP film. Coalesces seeks so Safari does not queue them. */
export function bindFilmScrub(video: HTMLVideoElement) {
  let pending = false;
  let target = 0;
  let progress = 0;
  let seekToken = 0;

  const apply = () => {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const next = Math.min(Math.max(target, 0), Math.max(duration - 0.04, 0));
    if (Math.abs(video.currentTime - next) < 1 / 24) return;
    if (pending) return;
    pending = true;
    const mine = ++seekToken;
    let timer = 0;
    const finish = () => {
      if (mine !== seekToken) return;
      seekToken += 1;
      window.clearTimeout(timer);
      video.removeEventListener('seeked', finish);
      pending = false;
      apply();
    };
    timer = window.setTimeout(finish, 220);
    video.addEventListener('seeked', finish);
    try {
      video.currentTime = next;
    } catch {
      window.clearTimeout(timer);
      video.removeEventListener('seeked', finish);
      if (mine === seekToken) seekToken += 1;
      pending = false;
    }
  };

  const sync = () => {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    target = progress * Math.max(duration - 0.04, 0);
    apply();
  };

  let arming = false;
  const kick = () => {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0 || video.readyState < 2) {
      if (!arming) {
        arming = true;
        video.addEventListener(
          'loadeddata',
          () => {
            arming = false;
            sync();
          },
          { once: true },
        );
      }
      return;
    }
    target = progress * Math.max(duration - 0.04, 0);
    apply();
  };

  return {
    setProgress(next: number) {
      progress = Math.min(Math.max(next, 0), 1);
      kick();
    },
  };
}
