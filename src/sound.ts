type SoundCloudOptions = {
    trackUrl: string
    startMs?: number
}

const loadSoundCloudWidgetApi = () =>
    new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(
            'script[data-soundcloud-widget]'
        )
        if (existing) {
            existing.addEventListener('load', () => resolve())
            if ((window as unknown as { SC?: unknown }).SC) {
                resolve()
            }
            return
        }
        const script = document.createElement('script')
        script.dataset.soundcloudWidget = 'true'
        script.src = 'https://w.soundcloud.com/player/api.js'
        script.async = true
        script.addEventListener('load', () => resolve())
        script.addEventListener('error', () =>
            reject(new Error('Failed to load SoundCloud widget API'))
        )
        document.head.appendChild(script)
    })

const setupSoundCloudSeek = async (
    iframe: HTMLIFrameElement,
    startMs: number
) => {
    if (startMs <= 0) {
        return
    }
    try {
        await loadSoundCloudWidgetApi()
        const sc = (window as unknown as { SC: any }).SC
        if (!sc?.Widget) {
            return
        }
        const widget = sc.Widget(iframe)
        widget.bind(sc.Widget.Events.READY, () => {
            const handlePlay = () => {
                widget.seekTo(startMs)
                widget.unbind(sc.Widget.Events.PLAY, handlePlay)
            }
            widget.bind(sc.Widget.Events.PLAY, handlePlay)
        })
    } catch {
        // ignore: fallback to default playback behavior
    }
}

export const initSoundCloud = (
    app: HTMLDivElement,
    { trackUrl, startMs = 0 }: SoundCloudOptions
) => {
    const soundcloudPlayer = document.createElement('div')
    soundcloudPlayer.className = 'soundcloud-player'
    const soundcloudFrame = document.createElement('iframe')
    soundcloudFrame.title = 'SoundCloud player'
    soundcloudFrame.width = '100%'
    soundcloudFrame.height = '100%'
    soundcloudFrame.allow = 'autoplay'
    soundcloudFrame.loading = 'lazy'
    soundcloudFrame.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(
        trackUrl
    )}&color=%23ff5500&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false`
    soundcloudPlayer.appendChild(soundcloudFrame)
    app.appendChild(soundcloudPlayer)
    setupSoundCloudSeek(soundcloudFrame, startMs)
}
