<script lang="ts">
    let {
        rooms,
        onchange,
        onnotify,
    }: {
        /** Searchable names without a drawn room. */
        rooms: string[];
        onchange: (rooms: string[]) => void;
        onnotify: (message: string) => void;
    } = $props();
    const MAX = 100;
    let name = $state("");
    function add() {
        const trimmed = name.trim();
        if (!trimmed) return;
        if (rooms.length >= MAX) return onnotify(`Maximum ${MAX} rooms per building`);
        onchange([...rooms, trimmed]);
        name = "";
    }
    function rename(index: number, value: string) {
        if (value.trim()) onchange(rooms.map((r, i) => (i === index ? value.trim() : r)));
    }
</script>

<div class="rooms-editor">
    <p>Searchable names without a drawn room, e.g. "MRI suite". Directions lead to this building.</p>
    <form
        onsubmit={(e) => {
            e.preventDefault();
            add();
        }}
    >
        <input
            aria-label="New room name"
            placeholder="e.g. Examination room"
            maxlength="100"
            bind:value={name}
        /><button class="btn" type="submit" disabled={!name.trim()}>Add</button>
    </form>
    {#each rooms as room, i}<div class="room-row">
            <input
                aria-label={`Room ${i + 1} name`}
                value={room}
                maxlength="100"
                onchange={(e) => rename(i, e.currentTarget.value)}
            /><button
                aria-label={`Remove ${room}`}
                onclick={() => onchange(rooms.filter((_, j) => j !== i))}>×</button
            >
        </div>{/each}{#if !rooms.length}<p>No rooms added yet.</p>{/if}
</div>
