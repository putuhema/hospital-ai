<script lang="ts">
    import Icon from "./Icon.svelte";
    let { onimport, onnotify }: { onimport: () => void; onnotify: (message: string) => void } = $props();
</script>

<nav class="rail">
    <a class="brand" href="/" aria-label="Forma home">f<span>·</span></a><button
        class="rail-active"
        title="Layout editor"><Icon name="grid" /></button
    ><button title="Import layout" onclick={onimport}><Icon name="building" /></button>
    <div class="rail-spacer"></div>
    <span class="rail-line"></span><button
        class="avatar"
        title="Local workspace"
        onclick={() => onnotify("Your workspace is stored locally on this device")}>JD</button
    >
</nav>
