<script lang="ts">
    /**
     * AIRMA herself, the hospital's guide: the mascot's head, used as the app's
     * mark. `talking` opens her beak, while she writes a reply. The art is in
     * static/mascot (airma-head, airma-head-talk, airma-wave, airma-front).
     */
    let { size = 32, title = "AIRMA", talking = false }: { size?: number; title?: string; talking?: boolean } = $props();
</script>

<img
    class="logo"
    src={talking ? "/mascot/airma-head-talk.webp" : "/mascot/airma-head.webp"}
    width={Math.round((size * 142) / 160)}
    height={size}
    style:height={`${size}px`}
    alt={title}
    aria-hidden={title ? undefined : "true"}
    draggable="false"
/>

<style>
    .logo {
        display: inline-block;
        flex-shrink: 0;
        width: auto;
        aspect-ratio: 142 / 160;
        object-fit: contain;
        user-select: none;
        -webkit-user-drag: none;
    }
</style>
