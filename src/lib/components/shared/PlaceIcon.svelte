<script lang="ts" module>
    import { categories, category } from "$lib/model/categories";
    import { roomTypes } from "$lib/model/interiors";
    import type { Place } from "$lib/wayfinding/routing";

    // Icons are the inside of a 24 × 24 SVG drawn with a round 2px stroke,
    // like the landmark icons in categories.ts.
    const BUILDING = '<path d="M4 21V9l8-5 8 5v12M9 21v-6h6v6M3 21h18"/>',
        ROOM = '<path d="M6 21V4h10v17M4 21h16M13 12.5v.01"/>';
    const ROOM_ICONS: Record<string, string> = {
        toilet: '<text x="12" y="16" text-anchor="middle" font-size="9.5" font-weight="700" fill="currentColor" stroke="none">WC</text>',
        pharmacy: '<rect x="3.5" y="8.5" width="17" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="m9.5 9.5 5 5"/>',
        lab: '<path d="M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8.5 3h7M7.5 15h9"/>',
        radiology: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 6v12M8 8.5h8M8 11.5h8M9 14.5h6"/>',
        emergency: '<path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z"/>',
        stairs: '<path d="M3 20h5v-4h4v-4h4V8h5"/>',
        reception: category("info").icon,
        patient: '<path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M6.5 11.5v.01"/>',
        waiting: '<path d="M7 20v-5h10v5M7 15V6h10v9M5 11h2m10 0h2"/>',
        surgery: '<circle cx="12" cy="9" r="5"/><path d="M12 14v7M8 21h8"/>',
        perinatology: '<path d="M10 2h4M10.5 2v3m3-3v3M9 8a3 3 0 0 1 6 0v11a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2zM9 12h3m-3 3h3"/>',
    };

    export type IconFor = Pick<Place, "kind" | "detail" | "category">;

    /** The icon and colours for a place; landmarks get a solid badge. */
    export function iconFor(p: IconFor): { icon: string; color: string; solid: boolean } {
        if (p.kind === "landmark" || p.kind === "area") {
            const c = p.category ? category(p.category) : categories.find((c) => c.name === p.detail) ?? category("other");
            return { icon: c.icon, color: c.color, solid: true };
        }
        if (p.kind === "building") return { icon: BUILDING, color: "#e3eadc", solid: false };
        const t = roomTypes.find((t) => t.name === p.detail);
        return { icon: (t && ROOM_ICONS[t.type]) ?? ROOM, color: t?.color ?? "#e3eadc", solid: false };
    }
</script>

<script lang="ts">
    let { of, size = 36 }: { of: IconFor; size?: number } = $props();
    let look = $derived(iconFor(of));
</script>

<span
    class="place-icon"
    class:solid={look.solid}
    style:--color={look.color}
    style:--size={`${size}px`}
    aria-hidden="true"
>
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round">{@html look.icon}</svg
    >
</span>

<style>
    .place-icon {
        display: inline-grid;
        place-items: center;
        flex-shrink: 0;
        width: var(--size);
        height: var(--size);
        border-radius: 50%;
        background: var(--color);
        color: #2f4336;
        box-shadow: inset 0 0 0 1px #0000000f;
    }
    .place-icon.solid {
        color: white;
        box-shadow: none;
    }
    svg {
        width: 58%;
        height: 58%;
    }
</style>
