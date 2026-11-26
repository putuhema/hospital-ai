<script lang="ts" module>
    import type { Rive as RiveT } from "@rive-app/canvas";

    // The runtime and the file are loaded once, for every AIRMA on the page.
    let runtime: Promise<typeof import("@rive-app/canvas")> | null = null;
    let file: Promise<ArrayBuffer> | null = null;
    const loadRuntime = () =>
        (runtime ??= Promise.all([
            import("@rive-app/canvas"),
            import("@rive-app/canvas/rive.wasm?url"),
        ]).then(([rive, wasm]) => {
            rive.RuntimeLoader.setWasmUrl(wasm.default);
            return rive;
        }));
    const loadFile = () =>
        (file ??= fetch("/airma.riv").then((r) => {
            if (!r.ok) throw new Error(`airma.riv: ${r.status}`);
            return r.arrayBuffer();
        }));
</script>

<script lang="ts">
    /**
     * AIRMA, animated: static/airma.riv ("Artboard 1", "State Machine 1"),
     * driven through its view model "ViewModel1" — `mood` (what she is doing)
     * and `mouth` (the sound she is making). See $lib/assistant/mascot.
     * She fills the box she is put in.
     */
    import { onMount } from "svelte";
    import { REST, type Mood, type Mouth } from "$lib/assistant/mascot";

    let {
        mood = 0,
        mouth = REST,
        label = "",
    }: { mood?: Mood; mouth?: Mouth; label?: string } = $props();

    let canvas = $state<HTMLCanvasElement>();
    let ready = $state(false);
    let moodProp: { value: number } | null = null;
    let mouthProp: { value: number } | null = null;

    onMount(() => {
        let rive: RiveT | null = null;
        let gone = false;
        const resize = () => rive?.resizeDrawingSurfaceToCanvas();

        Promise.all([loadRuntime(), loadFile()])
            .then(([R, buffer]) => {
                if (gone || !canvas) return;
                const r: RiveT = new R.Rive({
                    buffer: buffer.slice(0),
                    canvas,
                    artboard: "Artboard 1",
                    stateMachines: "State Machine 1",
                    layout: new R.Layout({ fit: R.Fit.Contain, alignment: R.Alignment.Center }),
                    autoplay: true,
                    autoBind: false,
                    onLoad: () => {
                        if (gone) return;
                        const vm = r.viewModelByName("ViewModel1");
                        const instance = vm?.defaultInstance() ?? vm?.instance() ?? null;
                        if (instance) r.bindViewModelInstance(instance);
                        moodProp = instance?.number("mood") ?? null;
                        mouthProp = instance?.number("mouth") ?? null;
                        if (moodProp) moodProp.value = mood;
                        if (mouthProp) mouthProp.value = mouth;
                        r.resizeDrawingSurfaceToCanvas();
                        ready = true;
                    },
                });
                rive = r;
            })
            .catch(() => {});

        const observer = new ResizeObserver(resize);
        if (canvas) observer.observe(canvas);
        return () => {
            gone = true;
            observer.disconnect();
            rive?.cleanup();
            rive = null;
            moodProp = mouthProp = null;
        };
    });

    $effect(() => {
        const m = mood;
        if (ready && moodProp && moodProp.value !== m) moodProp.value = m;
    });
    $effect(() => {
        const m = mouth;
        if (ready && mouthProp && mouthProp.value !== m) mouthProp.value = m;
    });
</script>

<canvas
    bind:this={canvas}
    class="airma"
    class:ready
    role={label ? "img" : undefined}
    aria-label={label || undefined}
    aria-hidden={label ? undefined : "true"}
></canvas>

<style>
    .airma {
        display: block;
        width: 100%;
        height: 100%;
        opacity: 0;
        transition: opacity 240ms ease-out;
        user-select: none;
        -webkit-user-select: none;
        touch-action: manipulation;
    }
    .airma.ready {
        opacity: 1;
    }
    @media (prefers-reduced-motion: reduce) {
        .airma {
            transition: none;
        }
    }
</style>
