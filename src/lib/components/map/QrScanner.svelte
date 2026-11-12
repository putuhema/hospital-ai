<script lang="ts">
    import { onMount } from "svelte";
    import { readSign } from "$lib/signs";
    import { useLocale } from "$lib/i18n/locale.svelte";
    let {
        slug,
        onfound,
        onclose,
    }: {
        /** This map's hospital, so a sign of another hospital is turned away. */
        slug?: string;
        /** A sign of this map was read: its spot, as a place id. */
        onfound: (from: string) => void;
        onclose: () => void;
    } = $props();
    const { t } = useLocale();
    let video: HTMLVideoElement;
    let problem = $state<"camera" | "other-map" | "not-a-sign" | null>(null),
        starting = $state(true);

    type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
    type DetectorClass = { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

    onMount(() => {
        let stream: MediaStream | null = null,
            timer = 0,
            stopped = false;
        const canvas = document.createElement("canvas"),
            context = canvas.getContext("2d", { willReadFrequently: true });

        // The phone's own QR reader where there is one (Chrome on Android);
        // a small decoder in the page otherwise (iPhones), loaded only now.
        async function reader(): Promise<(v: HTMLVideoElement) => Promise<string | null>> {
            const Native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
            if (Native && (await Native.getSupportedFormats?.())?.includes("qr_code")) {
                const detector = new Native({ formats: ["qr_code"] });
                return async (v) => (await detector.detect(v))[0]?.rawValue ?? null;
            }
            const { default: jsQR } = await import("jsqr");
            return async (v) => {
                if (!context || !v.videoWidth) return null;
                // Scaled down: QR signs are big, and small frames decode fast on budget phones.
                const scale = Math.min(1, 640 / v.videoWidth);
                canvas.width = Math.round(v.videoWidth * scale);
                canvas.height = Math.round(v.videoHeight * scale);
                context.drawImage(v, 0, 0, canvas.width, canvas.height);
                const image = context.getImageData(0, 0, canvas.width, canvas.height);
                return jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data ?? null;
            };
        }

        (async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: "environment" },
                    audio: false,
                });
            } catch {
                problem = "camera";
                starting = false;
                return;
            }
            if (stopped) return stream.getTracks().forEach((track) => track.stop());
            video.srcObject = stream;
            await video.play().catch(() => {});
            starting = false;
            const read = await reader();
            const look = async () => {
                if (stopped) return;
                const text = await read(video).catch(() => null);
                if (text) {
                    const sign = readSign(text, slug);
                    if ("from" in sign) {
                        navigator.vibrate?.(40);
                        return onfound(sign.from);
                    }
                    problem = sign.error;
                }
                timer = window.setTimeout(look, 250);
            };
            look();
        })();

        return () => {
            stopped = true;
            clearTimeout(timer);
            stream?.getTracks().forEach((track) => track.stop());
        };
    });
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />
<div class="scanner" role="dialog" aria-modal="true" aria-label={t("scanTitle")}>
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} playsinline muted></video>
    <div class="frame" aria-hidden="true"></div>
    <div class="say">
        <b>{t("scanTitle")}</b>
        <p role="status">
            {#if problem === "camera"}{t("scanNoCamera")}{:else if problem === "other-map"}{t("scanOtherMap")}{:else if problem === "not-a-sign"}{t(
                    "scanNotSign",
                )}{:else if starting}{t("scanStarting")}{:else}{t("scanHint")}{/if}
        </p>
    </div>
    <button class="close" onclick={onclose}>{t("cancel")}</button>
</div>

<style>
    .scanner {
        position: fixed;
        inset: 0;
        z-index: 50;
        background: #0d1511;
        color: white;
        display: grid;
        place-items: center;
    }
    video {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .frame {
        position: relative;
        width: min(64vw, 280px);
        aspect-ratio: 1;
        border-radius: 22px;
        box-shadow: 0 0 0 100vmax #0d1511a6;
        outline: 3px solid white;
    }
    .say {
        position: absolute;
        top: calc(env(safe-area-inset-top) + 24px);
        left: 20px;
        right: 20px;
        text-align: center;
    }
    .say b {
        font-size: 17px;
    }
    .say p {
        margin: 6px auto 0;
        max-width: 320px;
        font-size: 14px;
        line-height: 1.45;
        color: #e8efe9;
    }
    .close {
        position: absolute;
        bottom: calc(env(safe-area-inset-bottom) + 24px);
        padding: 12px 28px;
        border-radius: 999px;
        background: white;
        color: #1b2a21;
        font-size: 15px;
        font-weight: 600;
    }
</style>
