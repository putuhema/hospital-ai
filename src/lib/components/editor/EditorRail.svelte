<script lang="ts">
    import Icon from "./Icon.svelte";
    import Logo from "$lib/components/shared/Logo.svelte";
    let { onimport, onnotify }: { onimport: () => void; onnotify: (message: string) => void } = $props();
</script>

<nav class="rail">
    <a class="brand" href="/editor" title="P-Map Editor"><Logo size={36} title="P-Map Editor home" /></a><button
        class="rail-active"
        title="Layout editor"><Icon name="grid" /></button
    ><button title="Import layout" onclick={onimport}><Icon name="building" /></button>
    <div class="rail-spacer"></div>
    <span class="rail-line"></span><button
        title="Stored in this browser"
        aria-label="Where is my work saved?"
        onclick={() => onnotify("Your map is saved in this browser. Use Export to back it up.")}
        ><Icon name="save" /></button
    >
</nav>
