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
        | "next"
        | "layers"
        | "book"
        | "qr"
        | "users"
        | "undo"
        | "redo"
        | "hand"
        | "help"
        | "logout"
        | "upload"
        | "sliders"
        | "chevron-down"
        | "external"
        | "eye"
        | "eye-off";
</script>

<script lang="ts">
    let { name, size = 18 }: { name: IconName; size?: number } = $props();
</script>

<svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    >{#if name === "grid"}<rect x="3" y="3" width="7" height="7" rx="1.5" /><rect
            x="14"
            y="3"
            width="7"
            height="7"
            rx="1.5"
        /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect
            x="14"
            y="14"
            width="7"
            height="7"
            rx="1.5"
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
        />{:else if name === "upload"}<path
            d="M12 3v12m-4-8 4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"
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
        />{:else if name === "layers"}<path
            d="m12 2 10 5-10 5L2 7l10-5zM2 12l10 5 10-5M2 17l10 5 10-5"
        />{:else if name === "book"}<path
            d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"
        /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />{:else if name === "qr"}<rect
            x="3"
            y="3"
            width="7"
            height="7"
            rx="1"
        /><rect x="14" y="3" width="7" height="7" rx="1" /><rect
            x="3"
            y="14"
            width="7"
            height="7"
            rx="1"
        /><path d="M14 14h3v3h-3zm6 0v6h-6" />{:else if name === "users"}<circle
            cx="9"
            cy="8"
            r="4"
        /><path d="M2 20c0-3.5 3.1-6 7-6s7 2.5 7 6M17 6a3 3 0 0 1 0 6m5 8c0-2.8-2-4.8-4.5-5.3" />{:else if name === "undo"}<path
            d="M9 14 4 9l5-5"
        /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />{:else if name === "redo"}<path
            d="m15 14 5-5-5-5"
        /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />{:else if name === "hand"}<path
            d="M18 11V6a2 2 0 0 0-4 0v4M14 10V4a2 2 0 0 0-4 0v6M10 10V6a2 2 0 0 0-4 0v8l-1.5-1.5a2 2 0 0 0-2.8 2.8l4.8 5.2A4 4 0 0 0 9.4 22H15a5 5 0 0 0 5-5v-4a2 2 0 0 0-2-2z"
        />{:else if name === "help"}<circle cx="12" cy="12" r="9" /><path
            d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 3.9m0 3.2h.01"
        />{:else if name === "logout"}<path
            d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9"
        />{:else if name === "sliders"}<path
            d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M2 14h4m4-6h4m4 8h4"
        />{:else if name === "chevron-down"}<path d="m6 9 6 6 6-6" />{:else if name === "external"}<path
            d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
        />{:else if name === "eye"}<path
            d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"
        /><circle cx="12" cy="12" r="3" />{:else if name === "eye-off"}<path
            d="M9.9 4.2A10.7 10.7 0 0 1 12 4c6.5 0 10 8 10 8a17.8 17.8 0 0 1-3.2 4.3M6.6 6.6A17.7 17.7 0 0 0 2 12s3.5 8 10 8a10.4 10.4 0 0 0 4.8-1.2M14.1 14.1a3 3 0 0 1-4.2-4.2M2 2l20 20"
        />{:else}<path d="M5 12h14m-6-6 6 6-6 6" />{/if}</svg
>
