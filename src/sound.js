const loadSoundCloudWidgetApi = () => new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-soundcloud-widget]');
    if (existing) {
        existing.addEventListener('load', () => resolve());
        if (window.SC) {
            resolve();
        }
        return;
    }
    const script = document.createElement('script');
    script.dataset.soundcloudWidget = 'true';
    script.src = 'https://w.soundcloud.com/player/api.js';
    script.async = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Failed to load SoundCloud widget API')));
    document.head.appendChild(script);
});
const setupSoundCloudSeek = async (iframe, startMs) => {
    if (startMs <= 0) {
        return;
    }
    try {
        await loadSoundCloudWidgetApi();
        const sc = window.SC;
        if (!sc?.Widget) {
            return;
        }
        const widget = sc.Widget(iframe);
        widget.bind(sc.Widget.Events.READY, () => {
            const handlePlay = () => {
                widget.seekTo(startMs);
                widget.unbind(sc.Widget.Events.PLAY, handlePlay);
            };
            widget.bind(sc.Widget.Events.PLAY, handlePlay);
        });
    }
    catch {
        // ignore: fallback to default playback behavior
    }
};
export const initSoundCloud = (app, { trackUrl, startMs = 0 }) => {
    const volumeOffIcon = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M16.5 12a4.5 4.5 0 0 0-1.55-3.4l-.98 1.12A3 3 0 0 1 15 12c0 .83-.34 1.59-.9 2.14l.98 1.12A4.5 4.5 0 0 0 16.5 12z"/>
            <path d="M19 12a7 7 0 0 0-2.35-5.25l-1 1.15A5.5 5.5 0 0 1 17.5 12a5.5 5.5 0 0 1-1.85 4.1l1 1.15A7 7 0 0 0 19 12z"/>
            <path d="M11 4.5 6.5 8H3v8h3.5l4.5 3.5v-15z"/>
            <path d="m20.5 7.5-1-1-4 4-4-4-1 1 4 4-4 4 1 1 4-4 4 4 1-1-4-4 4-4z"/>
        </svg>
    `;
    const volumeOnIcon = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M16.5 12a4.5 4.5 0 0 0-1.55-3.4l-.98 1.12A3 3 0 0 1 15 12c0 .83-.34 1.59-.9 2.14l.98 1.12A4.5 4.5 0 0 0 16.5 12z"/>
            <path d="M19 12a7 7 0 0 0-2.35-5.25l-1 1.15A5.5 5.5 0 0 1 17.5 12a5.5 5.5 0 0 1-1.85 4.1l1 1.15A7 7 0 0 0 19 12z"/>
            <path d="M11 4.5 6.5 8H3v8h3.5l4.5 3.5v-15z"/>
        </svg>
    `;
    const soundcloudPlayer = document.createElement('div');
    soundcloudPlayer.className = 'soundcloud-player';
    const soundcloudFrame = document.createElement('iframe');
    soundcloudFrame.title = 'SoundCloud player';
    soundcloudFrame.width = '100%';
    soundcloudFrame.height = '100%';
    soundcloudFrame.allow = 'autoplay';
    soundcloudFrame.loading = 'lazy';
    soundcloudFrame.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(trackUrl)}&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false`;
    soundcloudPlayer.appendChild(soundcloudFrame);
    app.appendChild(soundcloudPlayer);
    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'soundcloud-toggle';
    toggleButton.innerHTML = volumeOffIcon;
    toggleButton.setAttribute('aria-label', 'Sound off');
    toggleButton.setAttribute('aria-pressed', 'false');
    app.appendChild(toggleButton);
    loadSoundCloudWidgetApi()
        .then(() => {
        const sc = window.SC;
        if (!sc?.Widget) {
            return;
        }
        const widget = sc.Widget(soundcloudFrame);
        let startApplied = false;
        const setToggleState = (isPlaying) => {
            toggleButton.innerHTML = isPlaying ? volumeOnIcon : volumeOffIcon;
            toggleButton.setAttribute('aria-label', isPlaying ? 'Sound on' : 'Sound off');
            toggleButton.setAttribute('aria-pressed', String(isPlaying));
        };
        widget.bind(sc.Widget.Events.READY, () => {
            setToggleState(false);
        });
        widget.bind(sc.Widget.Events.PLAY, () => {
            if (!startApplied && startMs > 0) {
                widget.seekTo(startMs);
                startApplied = true;
            }
            setToggleState(true);
        });
        widget.bind(sc.Widget.Events.PAUSE, () => {
            setToggleState(false);
        });
        toggleButton.addEventListener('click', () => {
            widget.isPaused((paused) => {
                if (paused) {
                    widget.play();
                }
                else {
                    widget.pause();
                }
            });
        });
    })
        .catch(() => {
        // ignore: fallback to no controls
    });
};
