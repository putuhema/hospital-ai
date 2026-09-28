<script module lang="ts">
    export type IconName =
        | "grid"
        | "building"
        | "corridor"
        | "search"
        | "cube"
        | "arrow"
        | "save"
        | "export"
        | "rotate"
        | "copy"
        | "trash"
        | "next";
</script>

<script lang="ts">
    let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    >{#if name === "grid"}<rect x="3" y="3" width="7" height="7" rx="1" /><rect
            x="14"
            y="3"
            width="7"
            height="7"
            rx="1"
        /><rect x="3" y="14" width="7" height="7" rx="1" /><rect
            x="14"
            y="14"
            width="7"
            height="7"
            rx="1"
        />{:else if name === "building"}<path
            d="M4 21V7l8-4 8 4v14M9 21v-5h6v5M8 9h1m6 0h1M8 12h1m6 0h1M2 21h20"
        />{:else if name === "corridor"}<path
            d="M3 8h8V3h5v5h5v6h-5v7h-5v-7H3z"
        />{:else if name === "search"}<circle cx="10" cy="10" r="6" /><path
            d="m15 15 5 5"
        />{:else if name === "cube"}<path
            d="m12 2 9 5v10l-9 5-9-5V7zm0 10 9-5M12 12 3 7m9 5v10"
        />{:else if name === "arrow"}<path
            d="m5 3 14 9-7 1-3 7z"
        />{:else if name === "save"}<path
            d="M5 3h12l4 4v14H3V3zm2 0v7h10V3M7 21v-7h10v7"
        />{:else if name === "export"}<path
            d="M12 15V3m-4 4 4-4 4 4M4 14v7h16v-7"
        />{:else if name === "rotate"}<path
            d="M4 9a8 8 0 1 1 0 7M4 3v6h6"
        />{:else if name === "copy"}<rect
            x="8"
            y="8"
            width="12"
            height="13"
            rx="2"
        /><path d="M16 8V3H3v13h5" />{:else if name === "trash"}<path
            d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"
        />{:else}<path d="M5 12h14m-6-6 6 6-6 6" />{/if}</svg
>
