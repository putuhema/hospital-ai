<script lang="ts">
    /** The AIRMA mark: a map pin with an A cut into it, and a spark beside it. */
    let { size = 32, title = "AIRMA" }: { size?: number; title?: string } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={title}
    ><path
        fill="#2d4a38"
        d="M16 1.5C9.1 1.5 3.6 6.9 3.6 13.6c0 9.1 12.4 16.9 12.4 16.9s12.4-7.8 12.4-16.9C28.4 6.9 22.9 1.5 16 1.5z"
    /><path
        fill="#f4f7ef"
        fill-rule="evenodd"
        d="M14.3 7.6h3.4l5 14h-3.2l-.95-2.9h-5.1l-.95 2.9H9.3zM16 11.2l1.7 5h-3.4z"
    /><circle cx="22.3" cy="9.8" r="1.7" fill="#a8c08a" /></svg
>
