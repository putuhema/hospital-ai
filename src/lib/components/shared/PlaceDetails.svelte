<script lang="ts">
    import { onMount } from "svelte";
    import { hoursLines, hoursStatus, type PlaceInfo } from "$lib/model/place-info";
    let { info }: { info: PlaceInfo } = $props();
    // The visitor's own clock: they are at the hospital, so it is the hospital's
    // time too. Unknown during server rendering, so the badge waits for the browser.
    let now = $state<Date | null>(null);
    onMount(() => {
        now = new Date();
        const timer = setInterval(() => (now = new Date()), 30_000);
        return () => clearInterval(timer);
    });
    let status = $derived(now && hoursStatus(info, now));
</script>

<section class="place-details" aria-label="About this destination">
    {#if status}<p class="badge" class:open={status.open}><i></i>{status.text}</p>{/if}
    {#if info.description}<p class="description">{info.description}</p>{/if}
    {#if info.phone}<a class="phone" href={`tel:${info.phone.replace(/[^\d+]/g, "")}`}>☎ {info.phone}</a>{/if}
    {#if info.hours?.length}<div class="hours">
            <small>{info.visiting ? "Visiting hours" : "Opening hours"}</small>
            {#each hoursLines(info.hours) as line}<span>{line}</span>{/each}
        </div>{/if}
</section>

<style>
    .place-details {
        margin-top: 12px;
        padding: 12px;
        border-radius: 10px;
        background: #f5f8f1;
        font-size: 12px;
        color: #2f4336;
        line-height: 1.45;
    }
    .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 8px;
        padding: 4px 10px;
        border-radius: 20px;
        background: #fbe6e3;
        color: #9a3b2e;
        font-weight: 600;
        font-size: 11.5px;
    }
    .badge i {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: currentColor;
    }
    .badge.open {
        background: #dff0dc;
        color: #2f6b3a;
    }
    .description {
        margin: 0 0 8px;
    }
    .phone {
        display: inline-block;
        margin-bottom: 8px;
        color: #2f6b8f;
        font-weight: 600;
        text-decoration: none;
    }
    .hours {
        display: flex;
        flex-direction: column;
    }
    .hours small {
        font-size: 10px;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: #7b8c70;
        margin-bottom: 2px;
    }
    .place-details > :last-child {
        margin-bottom: 0;
    }
</style>
